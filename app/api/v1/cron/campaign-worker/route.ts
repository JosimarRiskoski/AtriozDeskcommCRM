import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { runCampaignTick } from "@/lib/campaigns/worker";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const provided = bearer || req.headers.get("x-cron-secret")?.trim() || "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (!provided || !accepted.includes(provided)) return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  try {
    const summary = await runCampaignTick(createAdminClient() as unknown as import("@supabase/supabase-js").SupabaseClient);
    void audit({ action: "campaign.worker_run", organizationId: null, bypassedRls: true, requestId, metadata: summary });
    return ok(summary, { requestId });
  } catch (error) {
    return fail("internal_error", error instanceof Error ? error.message : "campaign_worker_failed", 500, { requestId });
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }

