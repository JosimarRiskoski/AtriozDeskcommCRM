import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const schema = z.object({
  assignee_user_id: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "agent_cases" });
  if (!authz.ok) return authz.response;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return fail("validation_failed", "Escolha um responsável e informe o motivo.", 422, {
      requestId,
    });
  const { id } = await ctx.params;
  const admin = createAdminClient();
  const { data: member } = await admin
    .from("user_organizations")
    .select("user_id,can_receive_human_cases,revoked_at,accepted_at")
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", parsed.data.assignee_user_id)
    .maybeSingle();
  if (!member || member.revoked_at || !member.accepted_at || !member.can_receive_human_cases) {
    return fail(
      "validation_failed",
      "Este membro não está habilitado para receber casos humanos.",
      422,
      { requestId },
    );
  }
  const { data: current } = await admin
    .from("agent_cases")
    .select("id,assignee_user_id,status")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (!current) return fail("not_found", "Caso não encontrado.", 404, { requestId });
  if (["resolved", "cancelled"].includes(current.status)) {
    return fail("state_conflict", "Um caso encerrado não pode ser transferido.", 409, {
      requestId,
    });
  }
  const kind = current.assignee_user_id ? "transferred" : "assigned";
  const { error } = await admin
    .from("agent_cases")
    .update({
      assignee_user_id: parsed.data.assignee_user_id,
      assigned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", authz.org.orgId);
  if (error) return fail("internal_error", "Não foi possível atribuir o caso.", 500, { requestId });
  await admin.from("agent_case_events").insert({
    organization_id: authz.org.orgId,
    case_id: id,
    kind,
    actor_kind: "human",
    actor_user_id: authz.user.id,
    body: parsed.data.reason,
    metadata: { from_user_id: current.assignee_user_id, to_user_id: parsed.data.assignee_user_id },
  });
  await audit({
    action: kind === "assigned" ? "human_case.assigned" : "human_case.transferred",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "agent_case",
    resourceId: id,
    requestId,
    metadata: {
      from_user_id: current.assignee_user_id,
      to_user_id: parsed.data.assignee_user_id,
      reason: parsed.data.reason,
    },
  });
  return ok({ id, assignee_user_id: parsed.data.assignee_user_id }, { requestId });
}
