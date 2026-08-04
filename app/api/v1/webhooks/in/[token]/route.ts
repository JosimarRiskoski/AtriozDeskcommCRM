/**
 * POST /api/v1/webhooks/in/[token] — captação pública de leads.
 *
 * Mesmo padrão do webhook WAHA per-tenant: path_token resolve o tenant
 * (fonte confiável — nunca o body), loga em webhook_events_log e NÃO executa
 * ação síncrona além de criar o lead (motor de regras consome lead.created
 * via event_log). Aceita JSON e form-urlencoded na mesma URL.
 */
import { createHash, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { findActiveContactByPhone } from "@/lib/contacts/find-by-phone";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLeadHandler } from "@/app/api/v1/leads/_handler";
import type { CreateLeadInput } from "@/lib/schemas";
import {
  isExternalAutomationActive,
  mapInboundPayload,
  verifyInboundSignature,
  type FieldMap,
} from "@/lib/webhooks/inbound";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";
import { ApiError } from "@/lib/api/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ token: string }>;
}

const RATE_LIMIT_PER_MIN = 60;

// ponytail: mirrors the default phone aliases in lib/webhooks/inbound.ts —
// duplicated (not exported there) only so the route can flag a phone-looking
// field that failed normalizePhoneBR, for observability. Keep in sync if that
// list changes.
const PHONE_ALIASES_FOR_LOGGING = [
  "phone",
  "telefone",
  "whatsapp",
  "celular",
  "phone_number",
  "tel",
];

function findRawPhoneIfUnnormalized(
  payload: Record<string, unknown>,
  fieldMap: FieldMap,
): string | null {
  const aliases = [...(fieldMap.phone ?? []), ...PHONE_ALIASES_FOR_LOGGING];
  const lowered = new Map(Object.keys(payload).map((k) => [k.toLowerCase(), k]));
  for (const alias of aliases) {
    const key = lowered.get(alias.toLowerCase());
    if (key !== undefined) {
      const v = payload[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const requestId = randomUUID();
  const { token } = await ctx.params;
  if (!token || token.length < 8) {
    return fail("not_found", "unknown webhook token", 404, { requestId });
  }

  const rl = await checkRateLimit(`webhook_in:${token}`, RATE_LIMIT_PER_MIN, 60);
  if (!rl.allowed) {
    return fail("rate_limited", "Too many requests.", 429, {
      requestId,
      headers: { "Retry-After": "60" },
    });
  }

  const admin = createAdminClient();
  const { data: source, error: srcErr } = await admin
    .from("webhook_sources")
    .select(
      "id, organization_id, secret_encrypted,previous_secret_encrypted,token_overlap_until, default_pipeline_id, default_stage_id, field_map, redirect_to, is_active, source_code, require_external_id,provider_type,create_opportunity,default_channel_session_id,default_agent_id,activate_ai,followup_flow_id,automation_enabled,pilot_approved_at,automation_external_state_field,name",
    )
    .eq("path_token", token)
    .maybeSingle();
  if (srcErr) return fail("internal_error", srcErr.message, 500, { requestId });
  if (!source || !source.is_active) {
    return fail("not_found", "unknown webhook token", 404, { requestId });
  }

  const rawBody = await req.text();
  const contentType = req.headers.get("content-type") ?? "";
  const isForm = contentType.includes("application/x-www-form-urlencoded");
  let payload: Record<string, unknown>;
  if (isForm) {
    payload = Object.fromEntries(new URLSearchParams(rawBody));
  } else {
    try {
      payload = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
    } catch {
      return fail("invalid_request", "invalid_json", 400, { requestId });
    }
  }

  const sigHeader = req.headers.get("x-deskcomm-signature");
  // secret cifrado at-rest (migration 0041). Decrypt falhou (chave da GUC
  // ausente/trocada)? Precedente WAHA: pula a validação em vez de derrubar a
  // captação — secret aqui é defesa opcional, não gate de disponibilidade.
  let sourceSecret: string | null = null;
  if (source.secret_encrypted) {
    sourceSecret = await decryptWebhookSecret(admin, source.secret_encrypted as unknown as string);
    if (sourceSecret === null) {
      return fail("integration_unavailable", "integration_secret_unavailable", 503, { requestId });
    }
  }
  let validSignature = sourceSecret
    ? verifyInboundSignature(rawBody, sigHeader, sourceSecret)
    : null;
  if (
    !validSignature &&
    source.previous_secret_encrypted &&
    source.token_overlap_until &&
    new Date(source.token_overlap_until) > new Date()
  ) {
    const previousSecret = await decryptWebhookSecret(
      admin,
      source.previous_secret_encrypted as unknown as string,
    );
    if (previousSecret) validSignature = verifyInboundSignature(rawBody, sigHeader, previousSecret);
  }
  if (sourceSecret && !validSignature) {
    await audit({
      action: "webhook.inbound_invalid_signature",
      organizationId: source.organization_id,
      resourceType: "webhook_source",
      resourceId: source.id,
      requestId,
    });
    return fail("unauthenticated", "invalid_signature", 401, { requestId });
  }

  const headersJson: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k.startsWith("authorization") || k === "cookie") return;
    headersJson[key] = value;
  });
  await admin.from("webhook_events_log").insert({
    organization_id: source.organization_id,
    provider: "generic",
    webhook_path_token: token,
    http_method: "POST",
    headers: headersJson,
    raw_body: rawBody,
    payload_parsed: payload,
    signature_header: sigHeader ?? null,
    // hmacSkipped (decrypt indisponível) conta como "não validado mas aceito",
    // igual ao webhook WAHA — o feed da UI não pinta de vermelho.
    valid_signature: validSignature ?? true,
    event_type: "lead_capture.received",
    external_id: null,
    status: "received",
    attempts: 0,
  });

  // Idempotência (spec §5): `external_id` é campo reservado do envio — quem
  // integra via sistema (Zapier/n8n/loja) manda o ID único do disparo e o
  // reenvio automático (retry por timeout) NUNCA duplica o lead. O índice
  // uniq_crm_leads_org_source_external garante a corrida; aqui vai o fast-path.
  const externalIdRaw = payload["external_id"];
  const externalId =
    typeof externalIdRaw === "string" && externalIdRaw.trim()
      ? externalIdRaw.trim().slice(0, 255)
      : null;
  if (source.require_external_id && !externalId) {
    return fail("invalid_request", "external_id é obrigatório para esta integração.", 400, {
      requestId,
    });
  }
  const sourceCode = source.source_code || "webhook";

  if (externalId) {
    const { data: receipt } = await admin
      .from("webhook_source_receipts")
      .select("contact_id,lead_id")
      .eq("webhook_source_id", source.id)
      .eq("external_id", externalId)
      .maybeSingle();
    if (receipt) {
      if (isForm && source.redirect_to)
        return NextResponse.redirect(source.redirect_to as string, 303);
      return ok(
        { contact_id: receipt.contact_id, lead_id: receipt.lead_id, duplicate: true },
        { requestId },
      );
    }
  }

  const respondWithLead = (leadId: string): NextResponse => {
    if (isForm && source.redirect_to) {
      return NextResponse.redirect(source.redirect_to as string, 303);
    }
    return ok({ lead_id: leadId }, { requestId });
  };

  const findLeadByExternalId = async (): Promise<string | null> => {
    if (!externalId) return null;
    const { data } = await admin
      .from("crm_leads")
      .select("id")
      .eq("organization_id", source.organization_id)
      .eq("source", sourceCode)
      .eq("external_id", externalId)
      .maybeSingle();
    return (data?.id as string | undefined) ?? null;
  };

  const dedupedLeadId = await findLeadByExternalId();
  if (dedupedLeadId) {
    // Mesmo envio repetido: 200 com o lead existente, nada é recriado — a
    // ferramenta que reenviou recebe sucesso e para de tentar.
    return respondWithLead(dedupedLeadId);
  }

  const fieldMap = (source.field_map ?? {}) as FieldMap;
  // external_id não é dado do lead — sai do payload antes do mapeamento pra
  // não virar custom_field (o log de recebimento acima preserva o original).
  const { external_id: _reservedExternalId, ...payloadForMapping } = payload;
  const mapped = mapInboundPayload(externalId ? payloadForMapping : payload, fieldMap);
  if (!mapped.phone) {
    const rawPhone = findRawPhoneIfUnnormalized(payload, fieldMap);
    if (rawPhone) mapped.source_metadata.raw_phone = rawPhone;
  }
  if (!mapped.phone && !mapped.email) {
    return fail("invalid_request", "Informe telefone ou e-mail para identificar o contato.", 400, {
      requestId,
    });
  }

  // Contato: upsert por telefone (se houver) — reusa a coluna E.164 canônica.
  // is_merged_into null: contato mesclado não deve ser reaproveitado (o índice
  // único uniq_contacts_org_phone só cobre a linha ativa por telefone).
  let contactId: string | undefined;
  if (mapped.phone) {
    const selectActiveByPhone = () =>
      admin
        .from("contacts")
        .select("id,name,email,source_metadata")
        .eq("organization_id", source.organization_id)
        .eq("phone_number", mapped.phone)
        .is("is_merged_into", null)
        .maybeSingle();

    const identity = await findActiveContactByPhone(admin, source.organization_id, mapped.phone);
    if (identity.kind === "ambiguous") {
      return fail(
        "contact_identity_ambiguous",
        "Existem contatos duplicados para este telefone. Revise-os antes de processar o lead.",
        409,
        { requestId, details: { contact_ids: identity.contactIds } },
      );
    }
    const { data: existing } =
      identity.kind === "found"
        ? await admin
            .from("contacts")
            .select("id,name,email,source_metadata")
            .eq("organization_id", source.organization_id)
            .eq("id", identity.contactId)
            .single()
        : await selectActiveByPhone();
    if (existing) {
      contactId = existing.id as string;
      await admin
        .from("contacts")
        .update({
          ...(mapped.name && !existing.name
            ? { name: mapped.name, display_name: mapped.name }
            : {}),
          ...(mapped.email && !existing.email ? { email: mapped.email } : {}),
          source: sourceCode,
          source_metadata: {
            ...((existing.source_metadata as Record<string, unknown> | null) ?? {}),
            webhook_source_id: source.id,
            webhook_source_name: source.name,
            provider_type: source.provider_type,
            channel_session_id: source.default_channel_session_id,
            external_id: externalId,
            ...mapped.source_metadata,
          },
        })
        .eq("id", contactId)
        .eq("organization_id", source.organization_id);
    } else {
      const { data: created, error: insertErr } = await admin
        .from("contacts")
        .insert({
          organization_id: source.organization_id,
          name: mapped.name ?? mapped.phone,
          display_name: mapped.name ?? mapped.phone,
          phone_number: mapped.phone,
          email: mapped.email,
          source: sourceCode,
          source_metadata: {
            webhook_source_id: source.id,
            webhook_source_name: source.name,
            provider_type: source.provider_type,
            channel_session_id: source.default_channel_session_id,
            external_id: externalId,
            ...mapped.source_metadata,
          },
        })
        .select("id")
        .maybeSingle();
      if (insertErr) {
        if (insertErr.code === "23505") {
          // Corrida: outro POST concorrente com o mesmo telefone novo já
          // criou o contato entre o select e o insert. Re-seleciona o
          // vencedor em vez de deixar o lead órfão.
          const { data: winner } = await selectActiveByPhone();
          contactId = (winner?.id as string | undefined) ?? undefined;
        } else {
          logger.error("[webhooks.inbound] contact insert failed", {
            webhookSourceId: source.id,
            organizationId: source.organization_id,
            errorCode: insertErr.code,
            errorMessage: insertErr.message,
          });
        }
      } else {
        contactId = (created?.id as string | undefined) ?? undefined;
      }
    }
  }

  if (!contactId && mapped.email) {
    const { data: existingByEmail } = await admin
      .from("contacts")
      .select("id,name,source_metadata")
      .eq("organization_id", source.organization_id)
      .eq("email", mapped.email)
      .is("is_merged_into", null)
      .maybeSingle();
    if (existingByEmail) {
      contactId = existingByEmail.id as string;
      await admin
        .from("contacts")
        .update({
          ...(mapped.name && !existingByEmail.name
            ? { name: mapped.name, display_name: mapped.name }
            : {}),
          source: sourceCode,
          source_metadata: {
            ...((existingByEmail.source_metadata as Record<string, unknown> | null) ?? {}),
            webhook_source_id: source.id,
            webhook_source_name: source.name,
            provider_type: source.provider_type,
            channel_session_id: source.default_channel_session_id,
            external_id: externalId,
            ...mapped.source_metadata,
          },
        })
        .eq("id", contactId)
        .eq("organization_id", source.organization_id);
    } else {
      const { data: createdContact } = await admin
        .from("contacts")
        .insert({
          organization_id: source.organization_id,
          name: mapped.name ?? mapped.email,
          display_name: mapped.name ?? mapped.email,
          email: mapped.email,
          source: sourceCode,
          source_metadata: {
            webhook_source_id: source.id,
            webhook_source_name: source.name,
            provider_type: source.provider_type,
            channel_session_id: source.default_channel_session_id,
            external_id: externalId,
            ...mapped.source_metadata,
          },
        })
        .select("id")
        .maybeSingle();
      contactId = createdContact?.id as string | undefined;
    }
  }

  if (!contactId) {
    return fail("internal_error", "Não foi possível criar ou localizar o contato.", 500, {
      requestId,
    });
  }

  const leadInput: CreateLeadInput & {
    custom_fields?: Record<string, unknown>;
    source_metadata?: Record<string, unknown>;
    external_id?: string;
  } = {
    pipeline_id: source.default_pipeline_id,
    stage_id: source.default_stage_id,
    title: mapped.name ?? mapped.phone ?? mapped.email ?? "Lead sem nome",
    contact_id: contactId,
    currency: "BRL",
    tags: [],
    source: sourceCode,
    custom_fields: mapped.custom_fields,
    source_metadata: { webhook_source_id: source.id, ...mapped.source_metadata },
    ...(externalId ? { external_id: externalId } : {}),
  };

  let lead: Record<string, unknown> | null = null;
  if (source.create_opportunity) {
    if (contactId) {
      const { data: existingOpportunity } = await admin
        .from("crm_leads")
        .select("*")
        .eq("organization_id", source.organization_id)
        .eq("contact_id", contactId)
        .eq("pipeline_id", source.default_pipeline_id)
        .eq("status", "open")
        .limit(1)
        .maybeSingle();
      if (existingOpportunity) lead = existingOpportunity as Record<string, unknown>;
    }
    if (!lead)
      try {
        lead = await createLeadHandler(
          admin,
          {
            organization_id: source.organization_id,
            actor: { type: "webhook_source", id: source.id },
            requestId,
          },
          leadInput,
        );
      } catch (err) {
        if (err instanceof ApiError) {
          // Corrida do retry: dois POSTs simultâneos com o mesmo external_id
          // passam ambos pelo fast-path; o índice único derruba o segundo INSERT
          // (23505) — re-seleciona o vencedor e responde idempotente.
          if (externalId && err.message?.includes("uniq_crm_leads_org_source_external")) {
            const winnerId = await findLeadByExternalId();
            if (winnerId) return respondWithLead(winnerId);
          }
          return fail(err.code, err.message ?? "erro", err.status, { requestId });
        }
        throw err;
      }
  }

  if (contactId && source.automation_enabled && source.pilot_approved_at) {
    let conversationId: string | null = null;
    if (source.default_channel_session_id && (source.activate_ai || source.followup_flow_id)) {
      const { data } = await admin.rpc("fn_upsert_wa_conversation", {
        p_org: source.organization_id,
        p_contact: contactId,
        p_session: source.default_channel_session_id,
      });
      conversationId = typeof data === "string" ? data : null;
    }
    const { data: intent } = await admin
      .from("webhook_source_intents")
      .upsert(
        {
          organization_id: source.organization_id,
          webhook_source_id: source.id,
          contact_id: contactId,
          external_id: externalId,
          idempotency_key: externalId ?? `contact:${contactId}`,
          default_agent_id: source.default_agent_id,
          activate_ai: source.activate_ai,
          followup_flow_id: source.followup_flow_id,
          conversation_id: conversationId,
          status: "pending",
          metadata: {
            source: sourceCode,
            external_automation_state: source.automation_external_state_field
              ? payload[source.automation_external_state_field]
              : null,
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "webhook_source_id,idempotency_key" },
      )
      .select("id")
      .maybeSingle();
    if (conversationId) {
      await admin
        .from("conversations")
        .update({
          effective_agent_id: source.default_agent_id,
          effective_agent_reason: source.default_agent_id
            ? `Origem automática: ${source.name}`
            : "Agente padrão da organização",
          effective_agent_at: new Date().toISOString(),
          ai_control_mode: source.activate_ai ? "force_active" : "force_paused",
        })
        .eq("id", conversationId)
        .eq("organization_id", source.organization_id);
      if (source.default_agent_id) {
        await admin.from("conversation_agent_events").insert({
          organization_id: source.organization_id,
          conversation_id: conversationId,
          to_agent_id: source.default_agent_id,
          selection_mode: "origin",
          reason: `Origem automática: ${source.name}`,
        });
      }
    }
    const externalAutomationState = source.automation_external_state_field
      ? payload[source.automation_external_state_field]
      : null;
    const externalAutomationActive = isExternalAutomationActive(externalAutomationState);
    if (source.followup_flow_id && !externalAutomationActive) {
      const { data: pointer } = await admin
        .from("followup_flow_pointers")
        .select("id,status,active_version_id")
        .eq("id", source.followup_flow_id)
        .eq("organization_id", source.organization_id)
        .maybeSingle();
      if (pointer?.status === "active" && pointer.active_version_id) {
        const { data: version } = await admin
          .from("followup_flow_versions")
          .select("graph")
          .eq("id", pointer.active_version_id)
          .eq("organization_id", source.organization_id)
          .maybeSingle();
        const graph = version?.graph as { nodes?: Array<{ id: string; type: string }> } | null;
        const trigger = graph?.nodes?.find((node) => node.type === "trigger");
        if (trigger) {
          await admin.from("followup_enrollments").insert({
            organization_id: source.organization_id,
            pointer_id: pointer.id,
            version_id: pointer.active_version_id,
            contact_id: contactId,
            conversation_id: conversationId,
            current_node_id: trigger.id,
            status: "active",
            next_eval_at: new Date().toISOString(),
            agent_id: source.default_agent_id,
          });
        }
      }
    }
    if (intent?.id)
      await admin
        .from("webhook_source_intents")
        .update({
          status: "applied",
          applied_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", intent.id);
  }

  if (externalId)
    await admin.from("webhook_source_receipts").insert({
      organization_id: source.organization_id,
      webhook_source_id: source.id,
      external_id: externalId,
      contact_id: contactId ?? null,
      lead_id: lead ? String(lead.id) : null,
      payload_sha256: createHash("sha256").update(rawBody).digest("hex"),
    });

  await admin
    .from("webhook_sources")
    .update({ last_received_at: new Date().toISOString() })
    .eq("id", source.id);

  await audit({
    action: "webhook.lead_received",
    organizationId: source.organization_id,
    resourceType: source.create_opportunity ? "crm_lead" : "contact",
    resourceId: source.create_opportunity ? String(lead?.id) : String(contactId),
    requestId,
    metadata: { webhook_source_id: source.id, source_code: sourceCode, external_id: externalId },
  });

  if (isForm && source.redirect_to) return NextResponse.redirect(source.redirect_to as string, 303);
  return ok(
    { contact_id: contactId ?? null, lead_id: lead ? String(lead.id) : null },
    { requestId },
  );
}
