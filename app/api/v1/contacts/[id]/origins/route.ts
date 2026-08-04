import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contact_source_events" as never)
    .select(
      "id,source,campaign_id,integration,channel_session_id,external_id,tracking,metadata,actor_user_id,occurred_at",
    )
    .eq("organization_id", authz.org.orgId)
    .eq("contact_id", id)
    .order("occurred_at", { ascending: true });
  if (error)
    return fail("internal_error", "Não foi possível carregar o histórico de origens.", 500, {
      requestId,
    });
  return ok(data ?? [], { requestId });
}
