import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const ruleSchema = z.object({
  pipeline_id: z.string().uuid(),
  stage_id: z.string().uuid(),
  event_name: z.enum(["Lead", "QualifiedLead", "Purchase"]),
  enabled: z.boolean(),
});

const bodySchema = z.object({ rules: z.array(ruleSchema).max(20) });

async function readRules(admin: SupabaseClient, organizationId: string) {
  const [{ data: pipelines, error: pipelineError }, { data: stages, error: stageError }, { data: rules, error: ruleError }] =
    await Promise.all([
      admin
        .from("crm_pipelines")
        .select("id,name,position")
        .eq("organization_id", organizationId)
        .eq("is_archived", false)
        .order("position"),
      admin
        .from("crm_stages")
        .select("id,pipeline_id,name,position,is_won,is_lost")
        .eq("organization_id", organizationId)
        .eq("is_archived", false)
        .order("position"),
      admin
        .from("meta_capi_event_rules")
        .select("id,pipeline_id,stage_id,event_name,enabled,updated_at")
        .eq("organization_id", organizationId)
        .order("created_at"),
    ]);

  if (pipelineError || stageError || ruleError) return null;
  return {
    pipelines: (pipelines ?? []).map((pipeline) => ({
      ...pipeline,
      stages: (stages ?? []).filter((stage) => stage.pipeline_id === pipeline.id),
    })),
    rules: rules ?? [],
  };
}

export async function GET() {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "meta_capi_event_rules" });
  if (!authz.ok) return authz.response;

  const data = await readRules(createAdminClient() as unknown as SupabaseClient, authz.org.orgId);
  if (!data) return fail("internal_error", "Falha ao ler os marcos automáticos da Meta.", 500, { requestId });
  return ok(data, { requestId });
}

export async function PUT(request: NextRequest) {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "meta_capi_event_rules" });
  if (!authz.ok) return authz.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Revise os marcos automáticos informados.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const duplicate = new Set<string>();
  for (const rule of parsed.data.rules) {
    const key = `${rule.pipeline_id}:${rule.stage_id}:${rule.event_name}`;
    if (duplicate.has(key)) {
      return fail("validation_failed", "Não repita o mesmo evento na mesma etapa.", 422, { requestId });
    }
    duplicate.add(key);
  }

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: existingRules, error: existingRulesError } = await admin
    .from("meta_capi_event_rules")
    .select("id,pipeline_id,stage_id,event_name")
    .eq("organization_id", authz.org.orgId);
  if (existingRulesError) {
    return fail("internal_error", "Não foi possível validar os marcos existentes.", 500, { requestId });
  }
  const stageIds = [...new Set(parsed.data.rules.map((rule) => rule.stage_id))];
  if (stageIds.length) {
    const { data: stages, error } = await admin
      .from("crm_stages")
      .select("id,pipeline_id")
      .eq("organization_id", authz.org.orgId)
      .in("id", stageIds);
    if (error || stages?.length !== stageIds.length) {
      return fail("validation_failed", "Uma das etapas não pertence à sua organização.", 422, {
        requestId,
      });
    }
    const pipelineByStage = new Map(stages.map((stage) => [stage.id, stage.pipeline_id]));
    if (parsed.data.rules.some((rule) => pipelineByStage.get(rule.stage_id) !== rule.pipeline_id)) {
      return fail("validation_failed", "A etapa escolhida não pertence ao funil selecionado.", 422, {
        requestId,
      });
    }
  }

  if (parsed.data.rules.length) {
    const now = new Date().toISOString();
    const { error } = await admin.from("meta_capi_event_rules").upsert(
      parsed.data.rules.map((rule) => ({
        organization_id: authz.org.orgId,
        ...rule,
        updated_at: now,
      })),
      { onConflict: "organization_id,pipeline_id,stage_id,event_name" },
    );
    if (error) return fail("internal_error", "Não foi possível salvar os marcos automáticos.", 500, { requestId });
  }

  // A tela representa a configuração inteira. Ao remover um marco, preservamos o
  // histórico dele, mas o desligamos para que nenhuma mudança futura de etapa dispare.
  const desiredKeys = new Set(
    parsed.data.rules.map((rule) => `${rule.pipeline_id}:${rule.stage_id}:${rule.event_name}`),
  );
  const rulesToDisable = (existingRules ?? [])
    .filter((rule) => !desiredKeys.has(`${rule.pipeline_id}:${rule.stage_id}:${rule.event_name}`))
    .map((rule) => rule.id);
  if (rulesToDisable.length) {
    const { error } = await admin
      .from("meta_capi_event_rules")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .in("id", rulesToDisable);
    if (error) return fail("internal_error", "Não foi possível desativar o marco removido.", 500, { requestId });
  }

  const data = await readRules(admin, authz.org.orgId);
  if (!data) return fail("internal_error", "Falha ao reler os marcos automáticos.", 500, { requestId });
  return ok(data, { requestId });
}
