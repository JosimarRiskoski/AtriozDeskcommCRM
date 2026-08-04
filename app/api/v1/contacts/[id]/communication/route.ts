import { randomUUID } from "node:crypto";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const actionSchema = z.object({
  action: z.enum(["block", "reactivate"]),
  reason: z.string().trim().min(3).max(500),
});

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
    .from("contact_communication_events" as never)
    .select("id,action,reason,source,actor_user_id,created_at")
    .eq("organization_id", authz.org.orgId)
    .eq("contact_id", id)
    .order("created_at", { ascending: false });
  if (error)
    return fail("internal_error", "Não foi possível carregar o histórico de comunicação.", 500, {
      requestId,
    });
  return ok(data ?? [], { requestId });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return fail("invalid_request", "Informe a ação e o motivo.", 422, { requestId });
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "fn_set_contact_communication_status" as never,
    {
      p_contact: id,
      p_blocked: parsed.data.action === "block",
      p_reason: parsed.data.reason,
      p_source: "manual_crm",
    } as never,
  );
  if (error)
    return fail("internal_error", "Não foi possível atualizar a comunicação do contato.", 500, {
      requestId,
    });
  await audit({
    action:
      parsed.data.action === "block"
        ? "contact.communication_blocked"
        : "contact.communication_reactivated",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "contact",
    resourceId: id,
    requestId,
    metadata: { reason: parsed.data.reason, result: data },
  });
  return ok(data, { requestId });
}
