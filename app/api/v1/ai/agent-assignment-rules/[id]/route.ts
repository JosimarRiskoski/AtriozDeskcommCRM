import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

const patchSchema = z.object({ is_active: z.boolean() });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "ai_agents" });
  if (!authz.ok) return authz.response;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Estado inválido.", 422, { requestId });
  const { id } = await params;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_agent_assignment_rules")
    .update(parsed.data)
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .select("id,is_active")
    .maybeSingle();
  if (error)
    return fail("internal_error", "Não foi possível atualizar a regra.", 500, { requestId });
  if (!data) return fail("not_found", "Regra não encontrada.", 404, { requestId });
  return ok(data, { requestId });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "ai_agents" });
  if (!authz.ok) return authz.response;
  const { id } = await params;
  const admin = createAdminClient();
  const { error } = await admin
    .from("ai_agent_assignment_rules")
    .delete()
    .eq("id", id)
    .eq("organization_id", authz.org.orgId);
  if (error) return fail("internal_error", "Não foi possível excluir a regra.", 500, { requestId });
  return ok({ deleted: true }, { requestId });
}
