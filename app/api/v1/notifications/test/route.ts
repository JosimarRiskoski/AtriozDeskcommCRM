import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "notification_events" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("fn_emit_notification", {
    p_org: authz.org.orgId,
    p_category: "mention",
    p_severity: "info",
    p_title: "Notificação de teste",
    p_body: "A central de notificações e as preferências estão funcionando.",
    p_action_url: "/app/settings/notifications",
    p_resource_type: null,
    p_resource_id: null,
    p_dedupe_key: `notification-test-${requestId}`,
    p_target_user: authz.user.id,
    p_metadata: { request_id: requestId },
  });
  if (error) return fail("internal_error", error.message, 500, { requestId });
  return ok({ id: data }, { requestId, status: 201 });
}

