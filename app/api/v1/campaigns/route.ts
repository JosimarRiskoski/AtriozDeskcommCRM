import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth/require-role";
import { fail, ok } from "@/lib/api/wrappers";
import { previewCampaignCsv } from "@/lib/campaigns/csv";
import { fetchGoogleSheetCsv, googleSheetErrorMessage } from "@/lib/campaigns/google-sheets";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLeadHandler } from "@/app/api/v1/leads/_handler";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const configSchema = z.object({
  name: z.string().trim().min(1).max(120),
  channel_session_id: z.string().uuid(),
  pipeline_id: z.string().uuid(),
  stage_id: z.string().uuid(),
  text_template: z.string().trim().min(1).max(4096),
  interval_seconds: z.coerce.number().int().min(60).max(86400).default(300),
  delay_before_audio_seconds: z.coerce.number().int().min(0).max(60).default(2),
  create_lead_before_send: z.boolean().default(true),
  ai_mode: z.enum(["paused", "inherit", "active"]).default("paused"),
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
  const { data: session } = await admin
    .from("channel_sessions")
    .select("id")
    .eq("id", config.channel_session_id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!session)
    return fail("not_found", "Conexão WhatsApp não encontrada nesta organização.", 404, {
      requestId,
    });

  const { data: campaign, error: campaignError } = await admin
    .from("outreach_campaigns")
    .insert({
      organization_id: orgId,
      channel_session_id: config.channel_session_id,
      name: config.name,
      text_template: config.text_template,
      interval_seconds: config.interval_seconds,
      delay_before_audio_seconds: config.delay_before_audio_seconds,
      create_lead_before_send: config.create_lead_before_send,
      ai_mode: config.ai_mode,
      status: "draft",
      created_by_user_id: authz.user.id,
      source_kind: source,
      source_metadata: sourceMetadata,
    })
    .select("id, name, status")
    .single();
  if (campaignError || !campaign)
    return fail("internal_error", "Não foi possível criar a campanha.", 500, { requestId });

  try {
    const recipients: Array<Record<string, unknown>> = [];
    for (const [position, row] of eligible.entries()) {
      const phone = row.phone_normalized!;
      const { data: contactId, error: contactError } = await admin.rpc("fn_upsert_wa_contact", {
        p_org: orgId,
        p_kind: "phone",
        p_phone: phone,
        p_lid: null,
        p_chat_id: `${phone.slice(1)}@c.us`,
        p_notify: row.name,
      });
      if (contactError || typeof contactId !== "string")
        throw new Error(`contact_upsert_failed:${contactError?.message ?? "no_id"}`);
      const { data: contact } = await admin
        .from("contacts")
        .select("id,name,display_name,email,is_blocked,is_anonymized")
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
          source: `campaign_${source}`,
        })
        .eq("id", contactId)
        .eq("organization_id", orgId);

      let leadId: string | null = null;
      if (config.create_lead_before_send) {
        const { data: existingLead } = await admin
          .from("crm_leads")
          .select("id")
          .eq("organization_id", orgId)
          .eq("pipeline_id", config.pipeline_id)
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
              pipeline_id: config.pipeline_id,
              stage_id: config.stage_id,
              title: row.name || phone,
              contact_id: contactId,
              currency: "BRL",
              tags: ["campanha"],
              source: `campaign_${source}`,
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
          p_session: config.channel_session_id,
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
        phone_normalized: phone,
        name: row.name,
        email: row.email,
        consent_confirmed: true,
        consent_source: source,
        contact_id: contactId,
        lead_id: leadId,
        conversation_id: conversationId,
        idempotency_key: `${campaign.id}:${phone}`,
        metadata: { csv_row: row.row },
      });
    }
    if (!recipients.length) throw new Error("no_unblocked_recipients");
    const { error: recipientError } = await admin
      .from("outreach_campaign_recipients")
      .insert(recipients);
    if (recipientError) throw recipientError;
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
    return fail("internal_error", "A campanha não foi criada; nenhuma mensagem foi enviada.", 500, {
      requestId,
    });
  }
}
