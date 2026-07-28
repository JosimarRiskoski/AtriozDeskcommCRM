/**
 * Épico Operação Visível (F1) — PATCH: arquiva/reativa uma entrada de memória
 * da org (migration 0067). Filtro `organization_id` sempre (admin client
 * bypassa RLS).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const patchSchema = z
  .object({
    status: z.enum(["archived", "active"]).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().trim().min(1).max(10_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Informe ao menos uma alteração.");

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) {
    return fail("invalid_request", "id inválido.", 400, { requestId });
  }

  const authz = await requireRole("manager", { requestId, resource: "org_memory" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org } = authz;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Alteração inválida.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_memory_entries")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .select("id, status")
    .single();
  if (error || !data) {
    return fail("not_found", "Entrada de memória não encontrada nesta organização.", 404, {
      requestId,
    });
  }

  await audit({
    action: "ai.org_memory_entry_updated",
    actorUserId: authUser.id,
    organizationId: org.orgId,
    resourceType: "org_memory_entries",
    resourceId: id,
    requestId,
    metadata: { fields: Object.keys(parsed.data), status: parsed.data.status },
  });

  return ok({ id: data.id, status: data.status }, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });

  const authz = await requireRole("manager", { requestId, resource: "org_memory" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org } = authz;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_memory_entries")
    .delete()
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .select("id")
    .single();
  if (error || !data) {
    return fail("not_found", "Entrada de memória não encontrada nesta organização.", 404, {
      requestId,
    });
  }

  await audit({
    action: "ai.org_memory_entry_deleted",
    actorUserId: authUser.id,
    organizationId: org.orgId,
    resourceType: "org_memory_entries",
    resourceId: id,
    requestId,
  });
  return ok({ id, deleted: true }, { requestId });
}
