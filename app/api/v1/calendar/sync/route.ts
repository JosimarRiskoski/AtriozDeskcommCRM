import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { syncGoogleCalendar } from "@/lib/calendar/sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "calendar_integrations" });
  if (!authz.ok) return authz.response;
  try {
    const result = await syncGoogleCalendar(
      createAdminClient() as unknown as SupabaseClient,
      authz.org.orgId,
    );
    return ok(result, { requestId });
  } catch (error) {
    return fail("calendar_sync_failed", "Não foi possível sincronizar o Google Agenda.", 502, {
      requestId,
      details: { reason: error instanceof Error ? error.message : "unknown" },
    });
  }
}
