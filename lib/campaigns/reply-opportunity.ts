import { createLeadHandler, moveLeadHandler } from "@/app/api/v1/leads/_handler";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  campaignReplyLeadTitle,
  decideReplyOpportunityAction,
  type ReplyOpportunityDecision,
} from "./reply-opportunity-decision";

type Admin = ReturnType<typeof createAdminClient>;

export { campaignReplyLeadTitle, decideReplyOpportunityAction, type ReplyOpportunityDecision };

type CampaignReplyCandidate = {
  id: string;
  campaign_id: string;
  outreach_campaigns: {
    id: string;
    name: string;
    pipeline_id: string | null;
    stage_id: string | null;
    create_lead_on_reply: boolean;
    reply_automation_enabled: boolean;
  } | null;
};

/**
 * Processa apenas destinatarios ja marcados como `replied` pelo ingest.
 * `lead_id` funciona como o marcador duravel de conclusao, portanto novos
 * webhooks da mesma conversa nao criam nem movem um card de novo.
 */
export async function createOrMoveCampaignOpportunityOnReply(input: {
  admin: Admin;
  organizationId: string;
  contactId: string;
  conversationId: string;
  requestId: string;
  recipientId?: string;
  targetStageId?: string;
}): Promise<void> {
  const { admin, organizationId, contactId, conversationId, requestId } = input;
  let lookup = admin
    .from("outreach_campaign_recipients")
    .select(
      "id,campaign_id,outreach_campaigns!inner(id,name,pipeline_id,stage_id,create_lead_on_reply,reply_automation_enabled)",
    )
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .eq("conversation_id", conversationId)
    .eq("status", "replied")
    .is("lead_id", null);
  if (input.recipientId) lookup = lookup.eq("id", input.recipientId);
  const { data, error } = await lookup;

  if (error) throw new Error(`campaign_reply_lookup_failed:${error.message}`);
  const candidates = (data ?? []) as unknown as CampaignReplyCandidate[];

  for (const recipient of candidates) {
    const campaign = recipient.outreach_campaigns;
    if (!campaign?.create_lead_on_reply || !campaign.pipeline_id || !campaign.stage_id ||
        (campaign.reply_automation_enabled && !input.recipientId)) {
      continue;
    }
    const targetStageId = input.targetStageId ?? campaign.stage_id;

    const { data: activeLead, error: activeLeadError } = await admin
      .from("crm_leads")
      .select("id,pipeline_id,stage_id")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .eq("status", "open")
      .limit(1)
      .maybeSingle();
    if (activeLeadError) {
      throw new Error(`campaign_reply_active_lead_lookup_failed:${activeLeadError.message}`);
    }

    const decision = decideReplyOpportunityAction({
      activeLead,
      targetPipelineId: campaign.pipeline_id,
    });
    let leadId: string;

    if (decision === "create") {
      try {
        const { data: contact, error: contactError } = await admin
          .from("contacts")
          .select("name,display_name,phone_number")
          .eq("organization_id", organizationId)
          .eq("id", contactId)
          .single();
        if (contactError || !contact) {
          throw new Error(`campaign_reply_contact_lookup_failed:${contactError?.message ?? "not_found"}`);
        }
        const lead = await createLeadHandler(
          admin,
          {
            organization_id: organizationId,
            actor: { type: "system", id: `campaign-reply:${recipient.campaign_id}` },
            requestId,
          },
          {
            pipeline_id: campaign.pipeline_id,
            stage_id: targetStageId,
            title: campaignReplyLeadTitle(contact),
            contact_id: contactId,
            conversation_id: conversationId,
            currency: "BRL",
            tags: ["campanha", "respondeu"],
            source: "campaign",
            source_metadata: {
              campaign_id: recipient.campaign_id,
              campaign_recipient_id: recipient.id,
              created_on_campaign_reply: true,
            },
            external_id: `campaign-reply:${recipient.campaign_id}:${recipient.id}`,
          },
        );
        leadId = String(lead.id);
      } catch (createError) {
        // Duas entregas concorrentes podem chegar antes da gravacao do lead_id.
        // O handler conserva a unicidade; aqui recuperamos o card vencedor.
        const { data: concurrentLead, error: concurrentError } = await admin
          .from("crm_leads")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("contact_id", contactId)
          .eq("status", "open")
          .limit(1)
          .maybeSingle();
        if (concurrentError || !concurrentLead) throw createError;
        leadId = concurrentLead.id;
      }
    } else {
      leadId = activeLead!.id;
      if (decision === "move" && activeLead!.stage_id !== targetStageId) {
        await moveLeadHandler(
          admin,
          {
            organization_id: organizationId,
            actor: { type: "system", id: `campaign-reply:${recipient.campaign_id}` },
            requestId,
          },
          leadId,
          { to_stage_id: targetStageId, reason: "Contato respondeu a campanha" },
        );
      }
    }

    const { error: linkError } = await admin
      .from("outreach_campaign_recipients")
      .update({ lead_id: leadId, updated_at: new Date().toISOString() })
      .eq("id", recipient.id)
      .eq("organization_id", organizationId)
      .is("lead_id", null);
    if (linkError) throw new Error(`campaign_reply_link_lead_failed:${linkError.message}`);
  }
}
