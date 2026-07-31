import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { summarizeCampaignRecipients } from "@/lib/campaigns/presentation";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "outreach_campaigns" });
  if (!authz.ok) return authz.response;

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("validation_failed", "Campanha inválida.", 422, { requestId });
  }

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: campaign, error: campaignError } = await admin
    .from("outreach_campaigns")
    .select(
      "id,name,status,text_template,audio_storage_path,delay_before_audio_seconds,interval_seconds,timezone,business_hour_start,business_hour_end,ai_mode,scheduled_for,next_dispatch_at,started_at,paused_at,completed_at,created_at,updated_at,channel_session_id",
    )
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();

  if (campaignError) {
    return fail("internal_error", "Não foi possível carregar a campanha.", 500, { requestId });
  }
  if (!campaign) return fail("not_found", "Campanha não encontrada.", 404, { requestId });

  const [{ data: recipients, error: recipientError }, { data: session }] = await Promise.all([
    admin
      .from("outreach_campaign_recipients")
      .select(
        "id,position,name,phone_normalized,status,text_sent_at,audio_sent_at,sent_at,replied_at,attempts,last_error_code,last_error_message,created_at,updated_at",
      )
      .eq("organization_id", authz.org.orgId)
      .eq("campaign_id", id)
      .order("position", { ascending: true }),
    admin
      .from("channel_sessions")
      .select("id,display_name,status")
      .eq("organization_id", authz.org.orgId)
      .eq("id", campaign.channel_session_id)
      .maybeSingle(),
  ]);

  if (recipientError) {
    return fail("internal_error", "Não foi possível carregar os destinatários.", 500, {
      requestId,
    });
  }

  return ok(
    {
      campaign,
      session,
      recipients: recipients ?? [],
      summary: summarizeCampaignRecipients((recipients ?? []).map((row) => row.status)),
    },
    { requestId },
  );
}
