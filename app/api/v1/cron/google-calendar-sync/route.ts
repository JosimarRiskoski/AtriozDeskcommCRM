import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ok, fail } from "@/lib/api/wrappers";
import { syncGoogleCalendar } from "@/lib/calendar/sync";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

async function handle(request: NextRequest) {
  const requestId = randomUUID();
  const auth = request.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (![env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean).includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: integrations, error } = await admin
    .from("calendar_integrations")
    .select("organization_id")
    .eq("status", "connected");
  if (error) return fail("internal_error", "calendar_integrations_unavailable", 500, { requestId });
  const outcomes: Array<{ organization_id: string; ok: boolean; error?: string }> = [];
  for (const integration of integrations ?? []) {
    try {
      await syncGoogleCalendar(admin, integration.organization_id);
      outcomes.push({ organization_id: integration.organization_id, ok: true });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.slice(0, 500) : "sync_failed";
      await admin
        .from("calendar_integrations")
        .update({ last_error: message })
        .eq("organization_id", integration.organization_id);
      outcomes.push({ organization_id: integration.organization_id, ok: false, error: message });
    }
  }
  return ok({ processed: outcomes.length, failed: outcomes.filter((item) => !item.ok).length }, { requestId });
}

export const GET = handle;
export const POST = handle;
