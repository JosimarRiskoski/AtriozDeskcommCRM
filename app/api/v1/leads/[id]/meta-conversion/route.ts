import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { metaConversionEventId } from "@/lib/meta-capi/manual";

export const dynamic = "force-dynamic";

const confirmSchema = z.object({ confirmed: z.literal(true) });

function publicEvent(row: Record<string, unknown> | null, requesterName?: string | null) {
  if (!row) return null;
  return {
    id: row.id,
    event_name: row.event_name,
    conversion_label: row.conversion_label,
    status: row.status,
    attempts: row.attempts,
    requested_at: row.requested_at,
    sent_at: row.sent_at,
    last_error: row.last_error,
    requested_by: requesterName ?? null,
  };
}

async function loadContext(admin: SupabaseClient, organizationId: string, leadId: string) {
  const [{ data: lead }, { data: setting }, { data: events }] = await Promise.all([
    admin
      .from("crm_leads")
      .select(
        "id,organization_id,title,status,value_cents,currency,contact_id,contacts:contact_id(name,display_name,phone_number,email,consent)",
      )
      .eq("id", leadId)
      .eq("organization_id", organizationId)
      .maybeSingle(),
    admin
      .from("meta_capi_settings")
      .select(
        "organization_id,dataset_id,event_name,conversion_label,currency,require_consent,enabled,test_event_code",
      )
      .eq("organization_id", organizationId)
      .maybeSingle(),
    admin
      .from("meta_conversion_events")
      .select(
        "id,event_name,conversion_label,status,attempts,requested_by_user_id,requested_at,sent_at,last_error,created_at",
      )
      .eq("organization_id", organizationId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const event = events?.find((item) => item.status === "sent") ?? events?.[0] ?? null;
  return { lead, setting, event };
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "meta_conversion_events" });
  if (!authz.ok) return authz.response;
  const { id: leadId } = await context.params;
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { lead, setting, event } = await loadContext(admin, authz.org.orgId, leadId);
  if (!lead) return fail("not_found", "Oportunidade nao encontrada.", 404, { requestId });
  let requesterName: string | null = null;
  if (event?.requested_by_user_id) {
    const { data } = await admin.auth.admin.getUserById(String(event.requested_by_user_id));
    requesterName =
      (data.user?.user_metadata?.full_name as string | undefined) ?? data.user?.email ?? null;
  }

  const contact = Array.isArray(lead.contacts) ? lead.contacts[0] : lead.contacts;
  const hasMatchingData = Boolean(contact?.phone_number || contact?.email);
  const hasConsent = contact?.consent?.meta_capi === true;
  return ok(
    {
      event: publicEvent(event as Record<string, unknown> | null, requesterName),
      eligible: Boolean(
        setting?.enabled && hasMatchingData && (!setting.require_consent || hasConsent),
      ),
      configuration: setting
        ? {
            enabled: setting.enabled,
            event_name: setting.event_name,
            conversion_label: setting.conversion_label || setting.event_name,
            test_mode: Boolean(setting.test_event_code),
            require_consent: setting.require_consent,
          }
        : null,
      opportunity: {
        id: lead.id,
        title: lead.title,
        status: lead.status,
        value_cents: lead.value_cents,
        currency: lead.currency,
      },
      matching: {
        phone: Boolean(contact?.phone_number),
        email: Boolean(contact?.email),
        consent: hasConsent,
      },
    },
    { requestId },
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "meta_conversion_events" });
  if (!authz.ok) return authz.response;
  const parsed = confirmSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail("confirmation_required", "Confirme explicitamente o envio da conversao.", 422, {
      requestId,
    });
  }
  const { id: leadId } = await context.params;
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { lead, setting, event } = await loadContext(admin, authz.org.orgId, leadId);
  if (!lead) return fail("not_found", "Oportunidade nao encontrada.", 404, { requestId });
  if (!setting?.enabled) {
    return fail(
      "meta_capi_disabled",
      "Ative e valide as Conversoes da Meta nas configuracoes.",
      409,
      { requestId },
    );
  }
  const contact = Array.isArray(lead.contacts) ? lead.contacts[0] : lead.contacts;
  if (!contact?.phone_number && !contact?.email) {
    return fail(
      "matching_data_missing",
      "O contato precisa ter telefone ou e-mail para correspondencia na Meta.",
      422,
      { requestId },
    );
  }
  if (setting.require_consent && contact?.consent?.meta_capi !== true) {
    return fail(
      "consent_missing",
      "O consentimento para a Meta CAPI ainda nao foi registrado neste contato.",
      422,
      { requestId },
    );
  }

  if (event?.status === "sent") {
    return fail(
      "conversion_already_sent",
      "Esta oportunidade ja teve uma conversao enviada para a Meta.",
      409,
      {
        requestId,
        details: publicEvent(event as Record<string, unknown>),
      },
    );
  }
  if (event?.status === "pending" || event?.status === "processing") {
    return ok(publicEvent(event as Record<string, unknown>), { requestId });
  }

  const now = new Date().toISOString();
  const eventId = metaConversionEventId(lead.id);
  const conversionLabel = setting.conversion_label || setting.event_name;
  const requestSummary = {
    opportunity_id: lead.id,
    opportunity_status: lead.status,
    has_phone: Boolean(contact.phone_number),
    has_email: Boolean(contact.email),
    value_cents: lead.value_cents,
    currency: lead.currency || setting.currency,
    test_mode: Boolean(setting.test_event_code),
    contact_fingerprint: createHash("sha256")
      .update(`${contact.phone_number || ""}|${contact.email || ""}`)
      .digest("hex")
      .slice(0, 16),
  };

  let saved: Record<string, unknown> | null = null;
  if (event) {
    const { data, error } = await admin
      .from("meta_conversion_events")
      .update({
        event_name: setting.event_name,
        event_id: eventId,
        status: "pending",
        attempts: 0,
        next_attempt_at: now,
        lease_until: null,
        response_json: null,
        last_error: null,
        sent_at: null,
        requested_by_user_id: authz.user.id,
        requested_at: now,
        conversion_label: conversionLabel,
        request_summary: requestSummary,
        updated_at: now,
      })
      .eq("id", event.id)
      .eq("organization_id", authz.org.orgId)
      .select("id,event_name,conversion_label,status,attempts,requested_at,sent_at,last_error")
      .single();
    if (error)
      return fail("internal_error", "Nao foi possivel preparar a conversao.", 500, { requestId });
    saved = data as Record<string, unknown>;
  } else {
    const { data, error } = await admin
      .from("meta_conversion_events")
      .insert({
        organization_id: authz.org.orgId,
        lead_id: lead.id,
        event_name: setting.event_name,
        event_id: eventId,
        status: "pending",
        requested_by_user_id: authz.user.id,
        requested_at: now,
        conversion_label: conversionLabel,
        request_summary: requestSummary,
      })
      .select("id,event_name,conversion_label,status,attempts,requested_at,sent_at,last_error")
      .single();
    if (error) {
      const duplicate = error.code === "23505";
      if (duplicate) {
        const { data: concurrent } = await admin
          .from("meta_conversion_events")
          .select("id,event_name,conversion_label,status,attempts,requested_at,sent_at,last_error")
          .eq("organization_id", authz.org.orgId)
          .eq("event_id", eventId)
          .maybeSingle();
        return ok(publicEvent(concurrent as Record<string, unknown> | null), { requestId });
      }
      return fail("internal_error", "Nao foi possivel preparar a conversao.", 500, { requestId });
    }
    saved = data as Record<string, unknown>;
  }

  await audit({
    action: "meta.conversion_requested",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "crm_lead",
    resourceId: lead.id,
    requestId,
    metadata: { event_name: setting.event_name, test_mode: Boolean(setting.test_event_code) },
  });
  return ok(publicEvent(saved, authz.user.full_name ?? authz.user.email), {
    status: 201,
    requestId,
  });
}
