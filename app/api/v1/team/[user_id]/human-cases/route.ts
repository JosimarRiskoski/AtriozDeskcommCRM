import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  can_receive_human_cases: z.boolean(),
  is_primary_human_case_responder: z.boolean(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ user_id: string }> }) {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const input = schema.safeParse(await req.json().catch(() => null));
  if (!input.success)
    return fail("validation_failed", "Configuração inválida.", 422, { requestId });
  if (input.data.is_primary_human_case_responder && !input.data.can_receive_human_cases) {
    return fail(
      "validation_failed",
      "O responsável principal precisa estar habilitado para receber casos.",
      422,
      { requestId },
    );
  }
  const { user_id } = await ctx.params;
  const admin = createAdminClient();
  const { data: target } = await admin
    .from("user_organizations")
    .select("id,revoked_at")
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", user_id)
    .maybeSingle();
  if (!target || target.revoked_at)
    return fail("not_found", "Membro ativo não encontrado.", 404, { requestId });
  if (input.data.is_primary_human_case_responder) {
    await admin
      .from("user_organizations")
      .update({ is_primary_human_case_responder: false })
      .eq("organization_id", authz.org.orgId)
      .eq("is_primary_human_case_responder", true);
  }
  const { error } = await admin
    .from("user_organizations")
    .update({ ...input.data, updated_at: new Date().toISOString() })
    .eq("id", target.id);
  if (error)
    return fail("internal_error", "Não foi possível atualizar o membro.", 500, { requestId });
  await audit({
    action: "team.human_case_eligibility_changed",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "membership",
    resourceId: target.id,
    requestId,
    metadata: { target_user_id: user_id, ...input.data },
  });
  return ok({ user_id, ...input.data }, { requestId });
}
