import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { syncGoogleCalendar } from "@/lib/calendar/sync";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const requestId = randomUUID();
  try {
    const authz = await requireRole("manager", { requestId, resource: "calendar_integrations" });
    if (!authz.ok) return authz.response;
    const result = await syncGoogleCalendar(
      createAdminClient() as unknown as SupabaseClient,
      authz.org.orgId,
    );
    return ok(result, { requestId });
  } catch (error) {
    logger.error("calendar.sync.request_failed", {
      requestId,
      error_type: error instanceof Error ? error.name : "unknown",
    });
    return fail("calendar_sync_failed", "Não foi possível sincronizar o Google Agenda.", 502, {
      requestId,
    });
  }
}
