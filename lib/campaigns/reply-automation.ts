import type { SupabaseClient } from "@supabase/supabase-js";

import { moveLeadHandler } from "@/app/api/v1/leads/_handler";
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { isExplicitStopRequest } from "@/lib/whatsapp/stop-detection";
import type { EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { renderCampaignText } from "@/lib/campaigns/worker-helpers";
import {
  campaignReplyDueAt,
  shouldAdvanceCampaignLead,
} from "@/lib/campaigns/reply-automation-helpers";

export const CAMPAIGN_REPLY_AUTOMATION_CONSUMER_KEY = "campaign-reply-automation";

type Candidate = {
  id: string;
  campaign_id: string;
  lead_id: string | null;
  conversation_id: string;
  name: string | null;
  phone_normalized: string;
  replied_at: string | null;
  reply_automation_attempts: number;
  outreach_campaigns: {
    pipeline_id: string | null;
    reply_message_template: string | null;
    reply_stage_id: string | null;
    reply_delay_seconds: number;
  } | null;
};

async function alreadyCreatedReply(
  admin: SupabaseClient,
  organizationId: string,
  candidate: Candidate,
): Promise<boolean> {
  const { count } = await admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("conversation_id", candidate.conversation_id)
    .in("status", ["queued", "sent", "delivered", "read"])
    .contains("metadata", {
      campaign_recipient_id: candidate.id,
      campaign_part: "automatic_reply",
    });
  return (count ?? 0) > 0;
}

async function advanceLead(
  admin: SupabaseClient,
  organizationId: string,
  candidate: Candidate,
  targetStageId: string,
): Promise<"moved" | "already_ahead" | "missing"> {
  if (!candidate.lead_id) return "missing";
  const [{ data: lead }, { data: target }] = await Promise.all([
    admin
      .from("crm_leads")
      .select("id,pipeline_id,stage_id,crm_stages:stage_id(position)")
      .eq("organization_id", organizationId)
      .eq("id", candidate.lead_id)
      .maybeSingle(),
    admin
      .from("crm_stages")
      .select("id,pipeline_id,position")
      .eq("organization_id", organizationId)
      .eq("id", targetStageId)
      .eq("is_archived", false)
      .maybeSingle(),
  ]);
  const campaign = candidate.outreach_campaigns;
  const current = lead?.crm_stages as unknown as { position: number } | null;
  if (!lead || !target || !campaign?.pipeline_id || !current) return "missing";
  if (
    !shouldAdvanceCampaignLead({
      leadPipelineId: lead.pipeline_id,
      campaignPipelineId: campaign.pipeline_id,
      currentStagePosition: current.position,
      targetStagePosition: target.position,
    })
  ) {
    return "already_ahead";
  }
  await moveLeadHandler(
    admin,
    {
      organization_id: organizationId,
      actor: { type: "webhook_source", id: `campaign:${candidate.campaign_id}` },
      requestId: `campaign-reply:${candidate.id}`,
    },
    lead.id,
    { to_stage_id: target.id },
  );
  return "moved";
}

export async function runCampaignReplyAutomation(
  admin: SupabaseClient,
  row: EventRow,
): Promise<HandlerResult> {
  const body = typeof row.payload.body_preview === "string" ? row.payload.body_preview : "";
  const contactId = typeof row.payload.contact_id === "string" ? row.payload.contact_id : null;
  const conversationId =
    typeof row.payload.conversation_id === "string" ? row.payload.conversation_id : null;
  if (!contactId || !conversationId || !row.entity_id) {
    return {
      consumer_key: CAMPAIGN_REPLY_AUTOMATION_CONSUMER_KEY,
      status: "skipped",
      detail: "missing_context",
    };
  }

  if (body && isExplicitStopRequest(body)) {
    await admin
      .from("outreach_campaign_recipients")
      .update({
        reply_automation_status: "skipped",
        reply_automation_last_error: "Pedido explícito para interromper mensagens.",
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", row.organization_id)
      .eq("contact_id", contactId)
      .eq("conversation_id", conversationId)
      .eq("status", "replied")
      .eq("reply_automation_status", "pending");
    return {
      consumer_key: CAMPAIGN_REPLY_AUTOMATION_CONSUMER_KEY,
      status: "skipped",
      detail: "explicit_stop_request",
    };
  }

  const { data, error: candidateError } = await admin
    .from("outreach_campaign_recipients")
    .select(
      "id,campaign_id,lead_id,conversation_id,name,phone_normalized,replied_at,reply_automation_attempts,outreach_campaigns!inner(pipeline_id,reply_message_template,reply_stage_id,reply_delay_seconds)",
    )
    .eq("organization_id", row.organization_id)
    .eq("contact_id", contactId)
    .eq("conversation_id", conversationId)
    .eq("status", "replied")
    .eq("reply_automation_status", "pending")
    .eq("outreach_campaigns.reply_automation_enabled", true)
    .order("replied_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (candidateError) {
    return {
      consumer_key: CAMPAIGN_REPLY_AUTOMATION_CONSUMER_KEY,
      status: "error",
      detail: candidateError.message,
    };
  }
  const candidate = data as unknown as Candidate | null;
  if (!candidate || !candidate.outreach_campaigns) {
    return {
      consumer_key: CAMPAIGN_REPLY_AUTOMATION_CONSUMER_KEY,
      status: "ok",
      detail: "no_pending_campaign_reply",
    };
  }

  const dueAt = campaignReplyDueAt(
    candidate.replied_at,
    candidate.outreach_campaigns.reply_delay_seconds,
  );
  if (dueAt.getTime() > Date.now()) {
    return {
      consumer_key: CAMPAIGN_REPLY_AUTOMATION_CONSUMER_KEY,
      status: "retry",
      retry_at: dueAt.toISOString(),
      detail: "reply_delay",
    };
  }

  const { data: claimed, error: claimError } = await admin.rpc(
    "fn_claim_campaign_reply_automation" as never,
    {
      p_org: row.organization_id,
      p_recipient: candidate.id,
      p_inbound_message: row.entity_id,
    } as never,
  );
  if (claimError) {
    return {
      consumer_key: CAMPAIGN_REPLY_AUTOMATION_CONSUMER_KEY,
      status: "error",
      detail: claimError.message,
    };
  }
  if (!claimed) {
    return {
      consumer_key: CAMPAIGN_REPLY_AUTOMATION_CONSUMER_KEY,
      status: "ok",
      detail: "already_claimed",
    };
  }

  try {
    const template = candidate.outreach_campaigns.reply_message_template;
    const targetStageId = candidate.outreach_campaigns.reply_stage_id;
    if (!template || !targetStageId) throw new Error("campaign_reply_config_missing");

    if (!(await alreadyCreatedReply(admin, row.organization_id, candidate))) {
      const message = await sendMessageHandler(
        admin,
        {
          organization_id: row.organization_id,
          actor: { type: "webhook_source", id: `campaign:${candidate.campaign_id}` },
          requestId: `campaign-reply:${candidate.id}`,
        },
        {
          conversation_id: candidate.conversation_id,
          type: "text",
          body: renderCampaignText(template, {
            recipient_name: candidate.name,
            phone_normalized: candidate.phone_normalized,
          }),
          metadata: {
            campaign_id: candidate.campaign_id,
            campaign_recipient_id: candidate.id,
            campaign_part: "automatic_reply",
            automation: "campaign_reply",
          },
        },
      );
      if (message.status !== "sent") {
        throw new Error(message.error_code || `automatic_reply_${message.status}`);
      }
      await admin
        .from("outreach_campaign_recipients")
        .update({ reply_automation_message_sent_at: new Date().toISOString() })
        .eq("id", candidate.id)
        .eq("organization_id", row.organization_id);
    }

    const moveResult = await advanceLead(admin, row.organization_id, candidate, targetStageId);
    const completedAt = new Date().toISOString();
    await admin
      .from("outreach_campaign_recipients")
      .update({
        reply_automation_status: "completed",
        reply_automation_completed_at: completedAt,
        reply_automation_last_error: null,
        updated_at: completedAt,
      })
      .eq("id", candidate.id)
      .eq("organization_id", row.organization_id);
    return {
      consumer_key: CAMPAIGN_REPLY_AUTOMATION_CONSUMER_KEY,
      status: "ok",
      detail: `automatic_reply_sent:${moveResult}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = candidate.reply_automation_attempts + 1;
    await admin
      .from("outreach_campaign_recipients")
      .update({
        reply_automation_status: attempts >= 3 ? "failed" : "pending",
        reply_automation_last_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", candidate.id)
      .eq("organization_id", row.organization_id);
    return {
      consumer_key: CAMPAIGN_REPLY_AUTOMATION_CONSUMER_KEY,
      status: "error",
      detail: message,
    };
  }
}
