import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth/require-role";
import { fail, ok } from "@/lib/api/wrappers";
import { previewCampaignCsv } from "@/lib/campaigns/csv";
import { fetchGoogleSheetCsv, googleSheetErrorMessage } from "@/lib/campaigns/google-sheets";
import { createAdminClient } from "@/lib/supabase/admin";
import { findActiveContactByPhone } from "@/lib/contacts/find-by-phone";
import { createLeadHandler } from "@/app/api/v1/leads/_handler";
import { audit } from "@/lib/audit";
import {
  distributeCampaignRecipients,
  estimateCampaignSchedule,
} from "@/lib/campaigns/distribution";

export const dynamic = "force-dynamic";

const configSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    channel_session_id: z.string().uuid(),
    channel_session_ids: z.array(z.string().uuid()).min(1).max(20),
    distribution_mode: z.enum(["single", "balanced"]).default("single"),
    pipeline_id: z.string().uuid().nullable(),
    stage_id: z.string().uuid().nullable(),
    text_template: z.string().trim().min(1).max(4096),
    interval_seconds: z.coerce.number().int().min(60).max(86400).default(300),
    delay_before_audio_seconds: z.coerce.number().int().min(0).max(60).default(2),
    create_lead_before_send: z.boolean().default(true),
    ai_mode: z.enum(["paused", "inherit", "active"]).default("paused"),
    business_hour_start: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .default("08:00"),
    business_hour_end: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .default("18:00"),
  })
  .superRefine((value, context) => {
    if (value.create_lead_before_send && (!value.pipeline_id || !value.stage_id)) {
      context.addIssue({
        code: "custom",
        message: "Escolha o pipeline e a etapa para criar oportunidades.",
        path: ["pipeline_id"],
      });
    }
    if (value.distribution_mode === "single" && value.channel_session_ids.length !== 1) {
      context.addIssue({
        code: "custom",
        message: "Sem divisão, selecione somente uma conexão.",
        path: ["channel_session_ids"],
      });
    }
    if (value.distribution_mode === "balanced" && value.channel_session_ids.length < 2) {
      context.addIssue({
        code: "custom",
        message: "Para dividir, selecione ao menos duas conexões.",
        path: ["channel_session_ids"],
      });
    }
    if (value.business_hour_start >= value.business_hour_end) {
      context.addIssue({
        code: "custom",
        message: "O fim da janela precisa ser posterior ao início.",
        path: ["business_hour_end"],
      });
    }
  });

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "outreach_campaigns" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await admin
    .from("outreach_campaigns")
    .select(
      "id,name,status,text_template,audio_storage_path,interval_seconds,ai_mode,scheduled_for,next_dispatch_at,created_at,outreach_campaign_recipients(count)",
    )
    .eq("organization_id", authz.org.orgId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error)
    return fail("internal_error", "Não foi possível listar as campanhas.", 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "outreach_campaigns" });
  if (!authz.ok) return authz.response;
  const form = await req.formData();
  const source = form.get("source") === "google_sheets" ? "google_sheets" : "csv";
  const file = form.get("file");
  const rawConfig = form.get("config");
  if ((source === "csv" && !(file instanceof File)) || typeof rawConfig !== "string") {
    return fail(
      "validation_failed",
      "Informe a lista autorizada e a configuração da campanha.",
      422,
      { requestId },
    );
  }
  let config: z.infer<typeof configSchema>;
  try {
    config = configSchema.parse(JSON.parse(rawConfig));
  } catch (error) {
    return fail("validation_failed", "Configuração da campanha inválida.", 422, {
      requestId,
      details: error instanceof z.ZodError ? error.flatten().fieldErrors : undefined,
    });
  }
  if (source === "csv" && file instanceof File && file.size > 2 * 1024 * 1024)
    return fail("validation_failed", "O CSV deve ter no máximo 2 MB.", 422, { requestId });

  let preview;
  let sourceMetadata: Record<string, unknown>;
  try {
    if (source === "google_sheets") {
      const sheet = await fetchGoogleSheetCsv(
        String(form.get("spreadsheet") ?? ""),
        String(form.get("range") ?? "A:Z"),
      );
      preview = previewCampaignCsv(sheet.csv);
      sourceMetadata = {
        spreadsheet_id: sheet.spreadsheetId,
        range: sheet.range,
        total_rows: preview.length,
      };
    } else {
      preview = previewCampaignCsv(await (file as File).text());
      sourceMetadata = { filename: (file as File).name, total_rows: preview.length };
    }
  } catch (error) {
    return fail(
      "validation_failed",
      source === "google_sheets"
        ? googleSheetErrorMessage(error)
        : "CSV inválido ou sem coluna de telefone.",
      422,
      { requestId },
    );
  }
  const eligible = preview.filter((row) => row.status === "eligible" && row.phone_normalized);
  if (!eligible.length) {
    return fail(
      "validation_failed",
      "Nenhum destinatário elegível. Verifique telefone e consentimento.",
      422,
      { requestId },
    );
  }

  const admin = createAdminClient() as unknown as SupabaseClient;
  const orgId = authz.org.orgId;
  const uniqueSessionIds = [...new Set(config.channel_session_ids)];
  const { data: selectedSessions } = await admin
    .from("channel_sessions")
    .select("id,display_name,phone_number,status,daily_message_limit")
    .eq("organization_id", orgId)
    .in("id", uniqueSessionIds);
  const healthySessions = (selectedSessions ?? []).filter(
    (session) => session.status === "WORKING",
  );
  if (healthySessions.length !== uniqueSessionIds.length)
    return fail(
      "validation_failed",
      "Uma ou mais conexões não estão ativas. Valide novamente a campanha.",
      422,
      {
        requestId,
      },
    );
  const today = new Date().toISOString().slice(0, 10);
  const { data: dailyUsage } = await admin
    .from("channel_session_warmup")
    .select("channel_session_id,messages_sent")
    .eq("organization_id", orgId)
    .eq("day", today)
    .in(
      "channel_session_id",
      healthySessions.map((session) => session.id),
    );
  const sentToday = new Map(
    (dailyUsage ?? []).map((row) => [row.channel_session_id, row.messages_sent]),
  );
  const distribution = distributeCampaignRecipients(
    eligible.map((row) => ({ key: row.phone_normalized!, row })),
    healthySessions.map((session) => ({
      id: session.id,
      label: session.display_name || session.phone_number || session.id,
      remainingCapacity: Math.max(
        0,
        (session.daily_message_limit ?? 0) - (sentToday.get(session.id) ?? 0),
      ),
    })),
    `${orgId}:${config.name}:${eligible.map((row) => row.phone_normalized).join(",")}`,
  );
  if (!distribution.assignments.length) {
    return fail(
      "validation_failed",
      "As conexões selecionadas não possuem capacidade disponível.",
      422,
      { requestId },
    );
  }
  const forecast = estimateCampaignSchedule({
    now: new Date(),
    timezone: "America/Sao_Paulo",
    businessStart: config.business_hour_start,
    businessEnd: config.business_hour_end,
    intervalSeconds: config.interval_seconds,
    counts: distribution.counts,
  });

  const { data: campaign, error: campaignError } = await admin
    .from("outreach_campaigns")
    .insert({
      organization_id: orgId,
      channel_session_id: config.channel_session_id,
      selected_channel_session_ids: uniqueSessionIds,
      distribution_mode: config.distribution_mode,
      pipeline_id: config.pipeline_id,
      stage_id: config.stage_id,
      name: config.name,
      text_template: config.text_template,
      interval_seconds: config.interval_seconds,
      business_hour_start: config.business_hour_start,
      business_hour_end: config.business_hour_end,
      delay_before_audio_seconds: config.delay_before_audio_seconds,
      create_lead_before_send: config.create_lead_before_send,
      ai_mode: config.ai_mode,
      status: "draft",
      created_by_user_id: authz.user.id,
      source_kind: source,
      source_metadata: sourceMetadata,
      eligible_count: distribution.assignments.length,
      estimated_started_at: forecast.projectedStart,
      estimated_completed_at: forecast.projectedEnd,
      estimated_duration_seconds: forecast.durationSeconds,
    })
    .select("id, name, status")
    .single();
  if (campaignError || !campaign)
    return fail("internal_error", "Não foi possível criar a campanha.", 500, { requestId });

  try {
    const recipients: Array<Record<string, unknown>> = [];
    for (const [position, assignment] of distribution.assignments.entries()) {
      const row = assignment.recipient.row;
      const phone = row.phone_normalized!;
      const identity = await findActiveContactByPhone(admin, orgId, phone);
      if (identity.kind === "ambiguous") throw new Error("contact_identity_ambiguous");
      const upsert =
        identity.kind === "found"
          ? { data: identity.contactId, error: null }
          : await admin.rpc("fn_upsert_wa_contact", {
              p_org: orgId,
              p_kind: "phone",
              p_phone: phone,
              p_lid: null,
              p_chat_id: `${phone.slice(1)}@c.us`,
              p_notify: row.name,
            });
      const { data: contactId, error: contactError } = upsert;
      if (contactError || typeof contactId !== "string")
        throw new Error(`contact_upsert_failed:${contactError?.message ?? "no_id"}`);
      const { data: contact } = await admin
        .from("contacts")
        .select("id,name,display_name,email,is_blocked,is_anonymized,source_metadata")
        .eq("id", contactId)
        .eq("organization_id", orgId)
        .single();
      if (!contact || contact.is_blocked || contact.is_anonymized) continue;
      await admin
        .from("contacts")
        .update({
          ...(row.name && !contact.name ? { name: row.name } : {}),
          ...(row.name && !contact.display_name ? { display_name: row.name } : {}),
          ...(row.email && !contact.email ? { email: row.email } : {}),
          consent: {
            whatsapp_outreach: true,
            source: `campaign_${source}`,
            confirmed_at: new Date().toISOString(),
          },
          source: "campaign",
          source_metadata: {
            ...((contact.source_metadata as Record<string, unknown> | null) ?? {}),
            campaign_id: campaign.id,
            campaign_name: config.name,
            channel_session_id: assignment.channelSessionId,
            source_kind: source,
          },
        })
        .eq("id", contactId)
        .eq("organization_id", orgId);

      let leadId: string | null = null;
      if (config.create_lead_before_send) {
        const { data: existingLead } = await admin
          .from("crm_leads")
          .select("id")
          .eq("organization_id", orgId)
          .eq("pipeline_id", config.pipeline_id!)
          .eq("contact_id", contactId)
          .eq("status", "open")
          .limit(1)
          .maybeSingle();
        if (existingLead) leadId = existingLead.id;
        else {
          const lead = await createLeadHandler(
            admin,
            { organization_id: orgId, actor: { type: "user", id: authz.user.id }, requestId },
            {
              pipeline_id: config.pipeline_id!,
              stage_id: config.stage_id!,
              title: row.name || phone,
              contact_id: contactId,
              currency: "BRL",
              tags: ["campanha"],
              source: "campaign",
              source_metadata: { campaign_id: campaign.id, ...sourceMetadata },
              external_id: `campaign:${campaign.id}:${phone}`,
            },
          );
          leadId = String(lead.id);
        }
      }
      const { data: conversationId, error: conversationError } = await admin.rpc(
        "fn_upsert_wa_conversation",
        {
          p_org: orgId,
          p_contact: contactId,
          p_session: assignment.channelSessionId,
        },
      );
      if (conversationError || typeof conversationId !== "string")
        throw new Error(`conversation_upsert_failed:${conversationError?.message ?? "no_id"}`);
      if (config.ai_mode !== "inherit") {
        await admin
          .from("conversations")
          .update({
            ai_control_mode: config.ai_mode === "active" ? "force_active" : "force_paused",
          })
          .eq("id", conversationId)
          .eq("organization_id", orgId);
      }
      recipients.push({
        organization_id: orgId,
        campaign_id: campaign.id,
        position,
        connection_position: assignment.connectionPosition,
        channel_session_id: assignment.channelSessionId,
        assigned_at: new Date().toISOString(),
        assignment_reason:
          config.distribution_mode === "balanced" ? "balanced_creation" : "single_creation",
        phone_normalized: phone,
        name: row.name,
        email: row.email,
        consent_confirmed: true,
        consent_source: source,
        contact_id: contactId,
        lead_id: leadId,
        conversation_id: conversationId,
        idempotency_key: `${campaign.id}:${phone}`,
        metadata: {
          csv_row: row.row,
          source: "campaign",
          campaign_id: campaign.id,
          campaign_name: config.name,
        },
      });
    }
    if (!recipients.length) throw new Error("no_unblocked_recipients");
    const { data: insertedRecipients, error: recipientError } = await admin
      .from("outreach_campaign_recipients")
      .insert(recipients)
      .select("id,channel_session_id,assignment_reason");
    if (recipientError) throw recipientError;
    await admin.from("outreach_campaign_connection_events").insert(
      (insertedRecipients ?? []).map((recipient) => ({
        organization_id: orgId,
        campaign_id: campaign.id,
        recipient_id: recipient.id,
        to_channel_session_id: recipient.channel_session_id,
        kind: "assigned",
        reason: String(recipient.assignment_reason),
        actor_user_id: authz.user.id,
      })),
    );
    await audit({
      action: "campaign.created",
      actorUserId: authz.user.id,
      organizationId: orgId,
      resourceType: "outreach_campaign",
      resourceId: campaign.id,
      requestId,
      metadata: { eligible: recipients.length, rejected: preview.length - recipients.length },
    });
    return ok(
      { ...campaign, recipients: recipients.length, rejected: preview.length - recipients.length },
      { status: 201, requestId },
    );
  } catch (error) {
    await admin
      .from("outreach_campaigns")
      .delete()
      .eq("id", campaign.id)
      .eq("organization_id", orgId);
    console.error("[campaign.create] rollback", error);
    if (error instanceof Error && error.message === "contact_identity_ambiguous") {
      return fail(
        "contact_identity_ambiguous",
        "Existem contatos duplicados pelo nono dígito. Revise-os antes de criar a campanha.",
        409,
        { requestId },
      );
    }
    return fail("internal_error", "A campanha não foi criada; nenhuma mensagem foi enviada.", 500, {
      requestId,
    });
  }
}
