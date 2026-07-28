import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { isWithinBusinessHours, renderCampaignText } from "./worker-helpers";

type Admin = SupabaseClient;
type Claim = {
  recipient_id: string; campaign_id: string; organization_id: string; conversation_id: string;
  recipient_name: string | null; phone_normalized: string; text_template: string;
  audio_storage_path: string | null; delay_before_audio_seconds: number; interval_seconds: number;
  campaign_timezone: string; business_hour_start: string; business_hour_end: string;
  text_sent_at: string | null; audio_sent_at: string | null;
};

export type CampaignTickSummary = { claimed: number; sent: number; deferred: number; failed: number; completed: number };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function wasAlreadyDelivered(admin: Admin, claim: Claim, part: "text" | "audio"): Promise<boolean> {
  const { count } = await admin.from("messages").select("id", { count: "exact", head: true })
    .eq("organization_id", claim.organization_id)
    .eq("conversation_id", claim.conversation_id)
    .in("status", ["sent", "delivered", "read"])
    .contains("metadata", { campaign_recipient_id: claim.recipient_id, campaign_part: part });
  return (count ?? 0) > 0;
}

export async function runCampaignTick(admin: Admin, now = new Date()): Promise<CampaignTickSummary> {
  const summary: CampaignTickSummary = { claimed: 0, sent: 0, deferred: 0, failed: 0, completed: 0 };
  const { data, error } = await admin.rpc("fn_claim_due_outreach_recipient", { p_lease_seconds: 180 });
  if (error) throw new Error(`campaign_claim_failed:${error.message}`);
  const claim = (Array.isArray(data) ? data[0] : null) as Claim | undefined;
  if (!claim) return summary;
  summary.claimed = 1;

  if (!isWithinBusinessHours(now, claim.campaign_timezone, claim.business_hour_start, claim.business_hour_end)) {
    await admin.from("outreach_campaign_recipients").update({ status: "pending", processing_lease_until: null, updated_at: now.toISOString() }).eq("id", claim.recipient_id);
    await admin.from("outreach_campaigns").update({ next_dispatch_at: new Date(now.getTime() + 15 * 60_000).toISOString(), updated_at: now.toISOString() }).eq("id", claim.campaign_id);
    summary.deferred = 1;
    return summary;
  }

  const ctx = { organization_id: claim.organization_id, actor: { type: "webhook_source" as const, id: `campaign:${claim.campaign_id}` }, requestId: randomUUID() };
  try {
    if (!claim.text_sent_at && await wasAlreadyDelivered(admin, claim, "text")) claim.text_sent_at = new Date().toISOString();
    if (!claim.text_sent_at) {
      const text = await sendMessageHandler(admin, ctx, { conversation_id: claim.conversation_id, type: "text", body: renderCampaignText(claim.text_template, claim), metadata: { campaign_id: claim.campaign_id, campaign_recipient_id: claim.recipient_id, campaign_part: "text" } });
      if (text.status !== "sent") throw new Error(text.error_code || `text_${text.status}`);
      const textSentAt = new Date().toISOString();
      await admin.from("outreach_campaign_recipients").update({ text_sent_at: textSentAt, updated_at: textSentAt }).eq("id", claim.recipient_id);
      claim.text_sent_at = textSentAt;
    }

    if (!claim.audio_sent_at && await wasAlreadyDelivered(admin, claim, "audio")) claim.audio_sent_at = new Date().toISOString();
    if (claim.audio_storage_path && !claim.audio_sent_at) {
      await wait(claim.delay_before_audio_seconds * 1000);
      const source = claim.audio_storage_path;
      const filename = source.split("/").pop() || "audio.ogg";
      const destination = `${claim.organization_id}/${claim.conversation_id}/campaign-${claim.campaign_id}-${claim.recipient_id}-${filename}`;
      const { error: copyError } = await admin.storage.from("whatsapp-media").copy(source, destination);
      if (copyError && !/already exists/i.test(copyError.message)) throw new Error(`audio_copy_failed:${copyError.message}`);
      const audio = await sendMessageHandler(admin, ctx, { conversation_id: claim.conversation_id, type: "audio", media_storage_path: destination, media_mime: "audio/ogg", metadata: { campaign_id: claim.campaign_id, campaign_recipient_id: claim.recipient_id, campaign_part: "audio" } });
      if (audio.status !== "sent") throw new Error(audio.error_code || `audio_${audio.status}`);
      claim.audio_sent_at = new Date().toISOString();
    }

    const sentAt = new Date().toISOString();
    await admin.from("outreach_campaign_recipients").update({ status: "sent", sent_at: sentAt, audio_sent_at: claim.audio_sent_at, processing_lease_until: null, last_error_code: null, last_error_message: null, updated_at: sentAt }).eq("id", claim.recipient_id);
    const { count } = await admin.from("outreach_campaign_recipients").select("id", { count: "exact", head: true }).eq("campaign_id", claim.campaign_id).in("status", ["pending", "processing"]);
    const completed = (count ?? 0) === 0;
    await admin.from("outreach_campaigns").update(completed
      ? { status: "completed", completed_at: sentAt, next_dispatch_at: null, updated_at: sentAt }
      : { next_dispatch_at: new Date(Date.now() + claim.interval_seconds * 1000).toISOString(), updated_at: sentAt }).eq("id", claim.campaign_id);
    summary.sent = 1;
    summary.completed = completed ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { data: current } = await admin.from("outreach_campaign_recipients").select("attempts").eq("id", claim.recipient_id).maybeSingle();
    const failed = Number(current?.attempts ?? 1) >= 3;
    await admin.from("outreach_campaign_recipients").update({ status: failed ? "failed" : "pending", processing_lease_until: null, last_error_code: message.split(":", 1)[0], last_error_message: message.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", claim.recipient_id);
    await admin.from("outreach_campaigns").update({ next_dispatch_at: new Date(Date.now() + 60_000).toISOString(), updated_at: new Date().toISOString() }).eq("id", claim.campaign_id);
    summary.failed = 1;
  }
  return summary;
}
