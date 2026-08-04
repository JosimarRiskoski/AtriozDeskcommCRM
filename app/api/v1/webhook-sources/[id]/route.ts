/**
 * PATCH  /api/v1/webhook-sources/[id] — atualiza campos (inclui is_active — switch da UI).
 * DELETE /api/v1/webhook-sources/[id] — remove a fonte.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail, noContent } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { updateWebhookSourceSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("manager", { requestId, resource: "webhook_sources" });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = updateWebhookSourceSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("invalid_request", "Dados inválidos.", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  if (parsed.data.automation_enabled) {
    return fail(
      "validation_failed",
      "A automação só pode ser ativada pela homologação do piloto.",
      422,
      { requestId },
    );
  }

  const supabase = await createClient();
  const { data: existing, error: fetchErr } = await supabase
    .from("webhook_sources")
    .select("id,default_pipeline_id,default_stage_id")
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (fetchErr) return fail("internal_error", fetchErr.message, 500, { requestId });
  if (!existing) return fail("not_found", "Fonte não encontrada.", 404, { requestId });

  // secret plaintext do input vira secret_encrypted (migration 0041); a coluna
  // em claro não existe mais. `secret: null` remove o segredo da fonte.
  const { secret: patchedSecret, ...restPatch } = parsed.data;
  const effectivePipeline =
    restPatch.default_pipeline_id === undefined
      ? existing.default_pipeline_id
      : restPatch.default_pipeline_id;
  const effectiveStage =
    restPatch.default_stage_id === undefined
      ? existing.default_stage_id
      : restPatch.default_stage_id;
  const admin = createAdminClient();
  if (effectivePipeline) {
    const { data: pipeline } = await admin
      .from("crm_pipelines")
      .select("id")
      .eq("id", effectivePipeline)
      .eq("organization_id", activeOrg.orgId)
      .maybeSingle();
    if (!pipeline)
      return fail("validation_failed", "Funil inválido para esta organização.", 422, { requestId });
  }
  if (effectiveStage) {
    const { data: stage } = await admin
      .from("crm_stages")
      .select("id,pipeline_id")
      .eq("id", effectiveStage)
      .eq("organization_id", activeOrg.orgId)
      .maybeSingle();
    if (!stage || stage.pipeline_id !== effectivePipeline)
      return fail("validation_failed", "A etapa não pertence ao funil escolhido.", 422, {
        requestId,
      });
  }
  if (restPatch.default_channel_session_id) {
    const { data: session } = await admin
      .from("channel_sessions")
      .select("id,status")
      .eq("id", restPatch.default_channel_session_id)
      .eq("organization_id", activeOrg.orgId)
      .maybeSingle();
    if (!session || session.status !== "WORKING")
      return fail("validation_failed", "A conexão precisa estar ativa nesta organização.", 422, {
        requestId,
      });
  }
  if (restPatch.default_agent_id) {
    const { data: agent } = await admin
      .from("ai_agents")
      .select("id")
      .eq("id", restPatch.default_agent_id)
      .eq("organization_id", activeOrg.orgId)
      .maybeSingle();
    if (!agent)
      return fail("validation_failed", "Agente inválido para esta organização.", 422, {
        requestId,
      });
  }
  if (restPatch.followup_flow_id) {
    const { data: flow } = await admin
      .from("followup_flow_pointers")
      .select("id,status")
      .eq("id", restPatch.followup_flow_id)
      .eq("organization_id", activeOrg.orgId)
      .maybeSingle();
    if (!flow || flow.status !== "active")
      return fail(
        "validation_failed",
        "A cadência precisa estar publicada nesta organização.",
        422,
        { requestId },
      );
  }
  const patch: Record<string, unknown> = { ...restPatch, updated_at: new Date().toISOString() };
  if (patchedSecret !== undefined) {
    if (patchedSecret === null) {
      patch.secret_encrypted = null;
    } else {
      const enc = await encryptWebhookSecret(createAdminClient(), patchedSecret);
      if (enc === null) {
        return fail(
          "encryption_unavailable",
          "Não foi possível guardar o segredo com segurança. Configure NUVEMSHOP_OAUTH_ENCRYPTION_KEY (chave de cifra do banco) e tente de novo.",
          422,
          { requestId },
        );
      }
      patch.secret_encrypted = enc;
    }
  }

  const { data: updated, error: updErr } = await supabase
    .from("webhook_sources")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (updErr) return fail("internal_error", updErr.message, 500, { requestId });

  void audit({
    action: "webhook.source_updated",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "webhook_source",
    resourceId: id,
    requestId,
    // Nunca gravar o valor do secret no audit log — só o fato da troca.
    metadata: { ...restPatch, ...(patchedSecret !== undefined ? { secret_changed: true } : {}) },
  });

  const {
    secret_encrypted: encAfter,
    previous_secret_encrypted: _previous,
    ...updatedPublic
  } = updated as Record<string, unknown>;
  return ok({ ...updatedPublic, has_secret: encAfter !== null }, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("manager", { requestId, resource: "webhook_sources" });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  const supabase = await createClient();
  const { data: existing, error: fetchErr } = await supabase
    .from("webhook_sources")
    .select("id")
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (fetchErr) return fail("internal_error", fetchErr.message, 500, { requestId });
  if (!existing) return fail("not_found", "Fonte não encontrada.", 404, { requestId });

  const { error: delErr } = await supabase.from("webhook_sources").delete().eq("id", id);
  if (delErr) return fail("internal_error", delErr.message, 500, { requestId });

  void audit({
    action: "webhook.source_deleted",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "webhook_source",
    resourceId: id,
    requestId,
  });

  return noContent(requestId);
}
