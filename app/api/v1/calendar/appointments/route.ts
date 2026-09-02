import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { getCalendarAccess } from "@/lib/calendar/access";
import { createGoogleEvent, deleteGoogleEvent } from "@/lib/calendar/google";
import { renderReminderTemplate } from "@/lib/calendar/templates";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { syncGoogleCalendar } from "@/lib/calendar/sync";
import { moveLeadForAppointment } from "@/lib/leads/appointment-stage-move";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const createSchema = z
  .object({
    confirmed: z.literal(true),
    contact_id: z.string().uuid(),
    conversation_id: z.string().uuid().nullable().optional(),
    lead_id: z.string().uuid().nullable().optional(),
    assigned_user_id: z.string().uuid().nullable().optional(),
    appointment_type: z.enum(["visit", "consultation", "online", "other"]),
    title: z.string().trim().min(2).max(180),
    description: z.string().trim().max(5000).nullable().optional(),
    starts_at: z.string().datetime(),
    ends_at: z.string().datetime(),
    timezone: z.string().trim().min(3).max(80).default("America/Sao_Paulo"),
    location: z.string().trim().max(500).nullable().optional(),
    attendee_email: z.string().email().nullable().optional(),
    create_meet: z.boolean().default(false),
    reminder_24h_enabled: z.boolean().default(true),
    reminder_1h_enabled: z.boolean().default(true),
  })
  .refine((input) => new Date(input.ends_at) > new Date(input.starts_at), {
    message: "O término precisa ser posterior ao início.",
    path: ["ends_at"],
  });

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "calendar_appointments" });
  if (!authz.ok) return authz.response;
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const url = new URL(request.url);
  const from = url.searchParams.get("from") || new Date().toISOString();
  const until =
    url.searchParams.get("until") || new Date(Date.now() + 90 * 86400000).toISOString();
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: integration } = await admin
    .from("calendar_integrations")
    .select("last_sync_at")
    .eq("organization_id", authz.org.orgId)
    .eq("status", "connected")
    .maybeSingle();
  const stale =
    !integration?.last_sync_at ||
    Date.now() - new Date(integration.last_sync_at).getTime() > 60_000;
  if (stale) {
    await syncGoogleCalendar(admin, authz.org.orgId).catch(async (error) => {
      await admin
        .from("calendar_integrations")
        .update({ last_error: error instanceof Error ? error.message.slice(0, 500) : "sync_failed" })
        .eq("organization_id", authz.org.orgId);
    });
  }
  const { data, error } = await supabase
    .from("calendar_appointments")
    .select(
      "*, contacts:contact_id(id,name,display_name,phone_number,email), conversations:conversation_id(id), crm_leads:lead_id(id,title)",
    )
    .eq("organization_id", authz.org.orgId)
    .gte("starts_at", from)
    .lte("starts_at", until)
    .order("starts_at", { ascending: true });
  if (error) return fail("internal_error", "Não foi possível carregar a agenda.", 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "calendar_appointments" });
  if (!authz.ok) return authz.response;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors,
    });
  }
  const input = parsed.data;
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: contact, error: contactError } = await admin
    .from("contacts")
    .select("id,name,display_name,phone_number,email,is_blocked")
    .eq("id", input.contact_id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (contactError || !contact) {
    return fail("not_found", "Contato não encontrado.", 404, { requestId });
  }
  if (contact.is_blocked) {
    return fail("contact_blocked", "Este contato está bloqueado para comunicações.", 409, {
      requestId,
    });
  }
  let conversationId = input.conversation_id ?? null;
  if (!conversationId) {
    const { data: latestConversation } = await admin
      .from("conversations")
      .select("id")
      .eq("contact_id", input.contact_id)
      .eq("organization_id", authz.org.orgId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    conversationId = latestConversation?.id ?? null;
  }
  if (conversationId) {
    const { data: conversation } = await admin
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("contact_id", input.contact_id)
      .eq("organization_id", authz.org.orgId)
      .maybeSingle();
    if (!conversation) {
      return fail("invalid_conversation", "A conversa não pertence a este contato.", 422, {
        requestId,
      });
    }
  }
  if (!conversationId && (input.reminder_24h_enabled || input.reminder_1h_enabled)) {
    return fail(
      "calendar_conversation_required",
      "Este contato ainda não possui conversa no WhatsApp. Inicie uma conversa ou desative os lembretes antes de agendar.",
      422,
      { requestId },
    );
  }

  let googleEvent: { id: string } | null = null;
  let createdAppointmentId: string | null = null;
  let googleCalendarId: string | null = null;
  let googleAccessToken: string | null = null;
  try {
    const { accessToken, integration } = await getCalendarAccess(admin, authz.org.orgId);
    googleAccessToken = accessToken;
    googleCalendarId = integration.calendar_id;
    const event = await createGoogleEvent(accessToken, {
      calendarId: integration.calendar_id,
      title: input.title,
      description: input.description,
      startsAt: input.starts_at,
      endsAt: input.ends_at,
      timezone: input.timezone,
      location: input.location,
      attendeeEmail: input.attendee_email || contact.email,
      createMeet: input.create_meet,
    });
    googleEvent = event;
    const meetUrl =
      event.hangoutLink ||
      event.conferenceData?.entryPoints?.find((point) => point.entryPointType === "video")?.uri ||
      null;
    const { data: appointment, error: insertError } = await admin
      .from("calendar_appointments")
      .insert({
        organization_id: authz.org.orgId,
        integration_id: integration.id,
        contact_id: input.contact_id,
        conversation_id: conversationId,
        lead_id: input.lead_id ?? null,
        assigned_user_id: input.assigned_user_id ?? null,
        external_event_id: event.id,
        external_calendar_id: integration.calendar_id,
        appointment_type: input.appointment_type,
        title: input.title,
        description: input.description ?? null,
        starts_at: input.starts_at,
        ends_at: input.ends_at,
        timezone: input.timezone,
        location: input.location ?? null,
        meet_url: meetUrl,
        attendee_email: input.attendee_email || contact.email || null,
        reminder_24h_enabled: input.reminder_24h_enabled,
        reminder_1h_enabled: input.reminder_1h_enabled,
        created_by_user_id: authz.user.id,
        metadata: { google_html_link: event.htmlLink ?? null },
      })
      .select("*")
      .single();
    if (insertError || !appointment) throw insertError || new Error("appointment_insert_failed");
    createdAppointmentId = appointment.id;

    const reminderRows: Record<string, unknown>[] = [];
    const templateContext = {
      contactName: contact.name || contact.display_name,
      startsAt: input.starts_at,
      timezone: input.timezone,
      location: input.location,
      meetUrl,
    };
    const startsAtMs = new Date(input.starts_at).getTime();
    if (input.reminder_24h_enabled && startsAtMs - 86400000 > Date.now()) {
      reminderRows.push({
        organization_id: authz.org.orgId,
        appointment_id: appointment.id,
        conversation_id: conversationId,
        reminder_kind: "24h",
        scheduled_for: new Date(startsAtMs - 86400000).toISOString(),
        message_body: renderReminderTemplate(integration.reminder_24h_template, templateContext),
      });
    }
    if (input.reminder_1h_enabled && startsAtMs - 3600000 > Date.now()) {
      reminderRows.push({
        organization_id: authz.org.orgId,
        appointment_id: appointment.id,
        conversation_id: conversationId,
        reminder_kind: "1h",
        scheduled_for: new Date(startsAtMs - 3600000).toISOString(),
        message_body: renderReminderTemplate(integration.reminder_1h_template, templateContext),
      });
    }
    if (reminderRows.length) {
      const { error: reminderError } = await admin.from("calendar_reminders").insert(reminderRows);
      if (reminderError) throw reminderError;
    }
    if (input.lead_id) {
      await moveLeadForAppointment(admin, {
        organizationId: authz.org.orgId,
        leadId: input.lead_id,
        transition: "confirmed",
      }).catch((stageError) => {
        logger.error("[calendar] appointment created but lead stage sync failed", {
          appointment_id: appointment.id,
          lead_id: input.lead_id,
          error: stageError instanceof Error ? stageError.message : String(stageError),
        });
      });
    }
    return ok(appointment, { status: 201, requestId });
  } catch (error) {
    // O Google não participa da transação do Postgres. Compensamos qualquer falha
    // local para que uma nova tentativa não duplique o compromisso externo.
    if (createdAppointmentId) {
      await admin.from("calendar_appointments").delete().eq("id", createdAppointmentId);
    }
    if (googleEvent && googleCalendarId && googleAccessToken) {
      await deleteGoogleEvent(googleAccessToken, googleCalendarId, googleEvent.id).catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : "unknown";
    const notConnected = message === "google_calendar_not_connected";
    return fail(
      notConnected ? "calendar_not_connected" : "calendar_create_failed",
      notConnected
        ? "Conecte o Google Agenda nas configurações antes de agendar."
        : "Não foi possível criar o compromisso no Google Agenda.",
      notConnected ? 409 : 502,
      { requestId, details: { reason: message } },
    );
  }
}
