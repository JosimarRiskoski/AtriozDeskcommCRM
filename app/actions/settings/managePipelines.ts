"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const STAGE_HINTS = [
  "new",
  "qualifying",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
] as const;
const stageInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable()
    .optional(),
  expected_duration_hours: z.number().int().min(1).max(8760).nullable().optional(),
  requires_human: z.boolean().default(false),
  is_won: z.boolean().default(false),
  is_lost: z.boolean().default(false),
  agent_stage_hint: z.enum(STAGE_HINTS).nullable().optional(),
});

const PRESETS = {
  reuniao: [
    "Interesse",
    "Aguardando documentação",
    "Aguardando proposta",
    "Aguardando fechamento",
    "Fechado/Ganho",
    "Perdido",
  ],
  vendas: [
    "Novo lead",
    "Primeiro contato",
    "Em atendimento",
    "Diagnóstico",
    "Proposta enviada",
    "Negociação",
    "Fechado",
    "Perdido",
  ],
  imobiliaria: [
    "Novo interessado",
    "Contato realizado",
    "Perfil validado",
    "Visita agendada",
    "Proposta",
    "Negociação",
    "Fechado",
    "Perdido",
  ],
  energia: [
    "Novo lead",
    "Em atendimento",
    "Fatura recebida",
    "Análise",
    "Proposta enviada",
    "Aguardando decisão",
    "Fechado",
    "Não qualificado",
  ],
  servicos: [
    "Nova oportunidade",
    "Briefing",
    "Orçamento",
    "Aguardando aprovação",
    "Em execução",
    "Concluído",
    "Perdido",
  ],
  suporte: [
    "Novo chamado",
    "Triagem",
    "Em atendimento",
    "Aguardando cliente",
    "Resolvido",
    "Encerrado",
  ],
} as const;

async function requireAdmin() {
  const user = await loadAuthUser();
  if (!user) return null;
  const org = await resolveActiveOrg(user);
  if (!org || (!user.is_platform_admin && ROLE_RANK[org.role] < ROLE_RANK.admin)) return null;
  return { user, org, supabase: await createClient() };
}

function slugify(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "funil"
  );
}

function stageFlags(name: string, index: number, total: number) {
  const normalized = slugify(name);
  const isLost = /perdido|nao-qualificado|cancelado/.test(normalized);
  const isWon = !isLost && /fechado|concluido|resolvido/.test(normalized) && index >= total - 2;
  return {
    is_lost: isLost,
    is_won: isWon,
    // Os nomes de um modelo de funil não são uma decisão sobre o vocabulário
    // interno da IA. Só os resultados finais têm equivalência inequívoca.
    // Antes, por exemplo, "Fatura recebida" recebia o hint "qualified" e a
    // última etapa não perdida recebia "negotiation". Quando uma delas era
    // marcada como ganha/perdida, o CHECK do banco rejeitava a criação.
    agent_stage_hint: isLost ? "lost" : isWon ? "won" : null,
  };
}

export async function createPipeline(input: {
  name: string;
  preset: keyof typeof PRESETS;
  isDefault?: boolean;
}): Promise<Result<{ id: string }>> {
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(100),
      preset: z.enum(["reuniao", "vendas", "imobiliaria", "energia", "servicos", "suporte"]),
      isDefault: z.boolean().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Informe um nome e escolha um modelo." };
  const auth = await requireAdmin();
  if (!auth) return { ok: false, error: "Sem permissão para administrar funis." };
  const { user, org, supabase } = auth;
  const baseSlug = slugify(parsed.data.name);
  const [{ count }, { data: maxRows }] = await Promise.all([
    supabase
      .from("crm_pipelines")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.orgId)
      .like("slug", `${baseSlug}%`),
    supabase
      .from("crm_pipelines")
      .select("position")
      .eq("organization_id", org.orgId)
      .order("position", { ascending: false })
      .limit(1),
  ]);
  const slug = (count ?? 0) > 0 ? `${baseSlug}-${(count ?? 0) + 1}` : baseSlug;
  const position = Number(maxRows?.[0]?.position ?? -1) + 1;
  const { data: pipeline, error } = await supabase
    .from("crm_pipelines")
    .insert({
      organization_id: org.orgId,
      name: parsed.data.name,
      slug,
      position,
      is_default: false,
      vocabulary: { lead: "Lead", deal: "Negócio", won: "Ganho", lost: "Perdido" },
      settings: { fields: [], lost_reasons: [] },
    })
    .select("id")
    .single();
  if (error || !pipeline)
    return { ok: false, error: error?.message ?? "Não foi possível criar o funil." };
  const names = PRESETS[parsed.data.preset];
  const { error: stagesError } = await supabase.from("crm_stages").insert(
    names.map((name, position) => ({
      organization_id: org.orgId,
      pipeline_id: pipeline.id,
      name,
      slug: `${slug}-${slugify(name)}`,
      position,
      color: position === 0 ? "#3b82f6" : null,
      ...stageFlags(name, position, names.length),
    })) as never,
  );
  if (stagesError) {
    await supabase.from("crm_pipelines").delete().eq("id", pipeline.id);
    return { ok: false, error: stagesError.message };
  }
  if (parsed.data.isDefault) {
    const { data: changed, error: defaultError } = await supabase.rpc(
      "fn_set_default_pipeline" as never,
      { p_pipeline: pipeline.id } as never,
    );
    if (defaultError || changed !== true) {
      await supabase.from("crm_pipelines").delete().eq("id", pipeline.id);
      return {
        ok: false,
        error: defaultError?.message ?? "Não foi possível definir o novo funil como principal.",
      };
    }
  }
  await audit({
    action: "pipeline.created",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "pipeline",
    resourceId: pipeline.id,
    metadata: { preset: parsed.data.preset, stages: names.length },
  });
  revalidatePath("/app/settings/tenant/pipelines");
  return { ok: true, data: { id: pipeline.id } };
}

export async function setDefaultPipeline(pipelineId: string): Promise<Result> {
  const parsed = z.string().uuid().safeParse(pipelineId);
  const auth = await requireAdmin();
  if (!parsed.success || !auth) return { ok: false, error: "Funil inválido ou sem permissão." };
  const { user, org, supabase } = auth;
  const { data: target } = await supabase
    .from("crm_pipelines")
    .select("id")
    .eq("id", parsed.data)
    .eq("organization_id", org.orgId)
    .eq("is_archived", false)
    .maybeSingle();
  if (!target) return { ok: false, error: "Funil não encontrado." };
  const { data, error } = await supabase.rpc(
    "fn_set_default_pipeline" as never,
    {
      p_pipeline: parsed.data,
    } as never,
  );
  if (error || data !== true)
    return { ok: false, error: error?.message ?? "Não foi possível alterar o funil principal." };
  await audit({
    action: "pipeline.default_changed",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "pipeline",
    resourceId: parsed.data,
  });
  revalidatePath("/app/kanban");
  revalidatePath("/app/settings/tenant/pipelines");
  return { ok: true };
}

export async function updatePipelineIdentity(pipelineId: string, name: string): Promise<Result> {
  const parsed = z.string().trim().min(2).max(100).safeParse(name);
  const auth = await requireAdmin();
  if (!parsed.success || !auth)
    return { ok: false, error: !parsed.success ? "Nome inválido." : "Sem permissão." };
  const { user, org, supabase } = auth;
  const { error } = await supabase
    .from("crm_pipelines")
    .update({ name: parsed.data, updated_at: new Date().toISOString() })
    .eq("id", pipelineId)
    .eq("organization_id", org.orgId);
  if (error) return { ok: false, error: error.message };
  await audit({
    action: "pipeline.renamed",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "pipeline",
    resourceId: pipelineId,
    metadata: { name: parsed.data },
  });
  revalidatePath("/app/settings/tenant/pipelines");
  return { ok: true };
}

export async function renamePipelineStage(
  pipelineId: string,
  stageId: string,
  name: string,
): Promise<Result> {
  const parsed = z
    .object({
      pipelineId: z.string().uuid(),
      stageId: z.string().uuid(),
      name: z.string().trim().min(1).max(80),
    })
    .safeParse({ pipelineId, stageId, name });
  const auth = await requireAdmin();
  if (!parsed.success || !auth)
    return { ok: false, error: !parsed.success ? "Nome de etapa inválido." : "Sem permissão." };
  const { user, org, supabase } = auth;
  const { error } = await supabase
    .from("crm_stages")
    .update({ name: parsed.data.name, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.stageId)
    .eq("pipeline_id", parsed.data.pipelineId)
    .eq("organization_id", org.orgId);
  if (error) return { ok: false, error: error.message };
  await audit({
    action: "pipeline.stage_updated",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "pipeline_stage",
    resourceId: parsed.data.stageId,
    metadata: { pipeline_id: parsed.data.pipelineId, fields: ["name"] },
  });
  revalidatePath(`/app/pipelines/${parsed.data.pipelineId}`);
  revalidatePath("/app/settings/tenant/pipelines");
  return { ok: true };
}

export async function duplicatePipeline(pipelineId: string): Promise<Result<{ id: string }>> {
  const auth = await requireAdmin();
  if (!auth) return { ok: false, error: "Sem permissão." };
  const { user, org, supabase } = auth;
  const [{ data: source }, { data: stages }] = await Promise.all([
    supabase
      .from("crm_pipelines")
      .select("name,slug,description,vocabulary,settings")
      .eq("id", pipelineId)
      .eq("organization_id", org.orgId)
      .maybeSingle(),
    supabase
      .from("crm_stages")
      .select(
        "name,description,color,position,is_won,is_lost,requires_human,expected_duration_hours,agent_stage_hint",
      )
      .eq("pipeline_id", pipelineId)
      .eq("organization_id", org.orgId)
      .eq("is_archived", false)
      .order("position"),
  ]);
  if (!source) return { ok: false, error: "Funil não encontrado." };
  const slug = `${source.slug}-copia-${Date.now().toString(36)}`;
  const { data: maxRows } = await supabase
    .from("crm_pipelines")
    .select("position")
    .eq("organization_id", org.orgId)
    .order("position", { ascending: false })
    .limit(1);
  const { data: copy, error } = await supabase
    .from("crm_pipelines")
    .insert({
      organization_id: org.orgId,
      name: `${source.name} — cópia`,
      slug,
      position: Number(maxRows?.[0]?.position ?? -1) + 1,
      description: source.description,
      vocabulary: source.vocabulary,
      settings: source.settings,
    })
    .select("id")
    .single();
  if (error || !copy) return { ok: false, error: error?.message ?? "Falha ao duplicar." };
  if (stages?.length) {
    const { error: stagesError } = await supabase.from("crm_stages").insert(
      stages.map((stage, index) => ({
        ...stage,
        organization_id: org.orgId,
        pipeline_id: copy.id,
        position: index,
        slug: `${slug}-${slugify(stage.name)}-${index}`,
      })) as never,
    );
    if (stagesError) {
      await supabase.from("crm_pipelines").delete().eq("id", copy.id);
      return { ok: false, error: stagesError.message };
    }
  }
  await audit({
    action: "pipeline.duplicated",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "pipeline",
    resourceId: copy.id,
    metadata: { source_pipeline_id: pipelineId },
  });
  revalidatePath("/app/settings/tenant/pipelines");
  return { ok: true, data: { id: copy.id } };
}

export async function savePipelineStage(
  pipelineId: string,
  input: z.input<typeof stageInput>,
): Promise<Result> {
  const parsed = stageInput.safeParse(input);
  if (!z.string().uuid().safeParse(pipelineId).success || !parsed.success)
    return { ok: false, error: "Dados da etapa inválidos." };
  if (parsed.data.is_won && parsed.data.is_lost)
    return { ok: false, error: "Uma etapa não pode ser ganha e perdida ao mesmo tempo." };
  const auth = await requireAdmin();
  if (!auth) return { ok: false, error: "Sem permissão." };
  const { user, org, supabase } = auth;
  const { data: pipeline } = await supabase
    .from("crm_pipelines")
    .select("id,slug")
    .eq("id", pipelineId)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (!pipeline) return { ok: false, error: "Funil não encontrado." };
  const payload = {
    name: parsed.data.name,
    color: parsed.data.color ?? null,
    expected_duration_hours: parsed.data.expected_duration_hours ?? null,
    requires_human: parsed.data.requires_human,
    is_won: parsed.data.is_won,
    is_lost: parsed.data.is_lost,
    agent_stage_hint: parsed.data.is_won
      ? "won"
      : parsed.data.is_lost
        ? "lost"
        : (parsed.data.agent_stage_hint ?? null),
    updated_at: new Date().toISOString(),
  };
  let id = parsed.data.id;
  let error;
  if (id) {
    ({ error } = await supabase
      .from("crm_stages")
      .update(payload as never)
      .eq("id", id)
      .eq("pipeline_id", pipelineId)
      .eq("organization_id", org.orgId));
  } else {
    const { data: maxRows } = await supabase
      .from("crm_stages")
      .select("position")
      .eq("pipeline_id", pipelineId)
      .order("position", { ascending: false })
      .limit(1);
    const position = Number(maxRows?.[0]?.position ?? -1) + 1;
    const inserted = await supabase
      .from("crm_stages")
      .insert({
        ...payload,
        organization_id: org.orgId,
        pipeline_id: pipelineId,
        position,
        slug: `${pipeline.slug}-${slugify(parsed.data.name)}-${Date.now().toString(36)}`,
      } as never)
      .select("id")
      .single();
    error = inserted.error;
    id = (inserted.data as { id?: string } | null)?.id;
  }
  if (error) return { ok: false, error: error.message };
  await audit({
    action: parsed.data.id ? "pipeline.stage_updated" : "pipeline.stage_created",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "pipeline_stage",
    resourceId: id ?? null,
    metadata: { pipeline_id: pipelineId },
  });
  revalidatePath("/app/settings/tenant/pipelines");
  return { ok: true };
}

export async function movePipelineStage(
  pipelineId: string,
  stageId: string,
  direction: -1 | 1,
): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth) return { ok: false, error: "Sem permissão." };
  const { supabase } = auth;
  const { data, error } = await supabase.rpc(
    "fn_reorder_pipeline_stage" as never,
    { p_pipeline: pipelineId, p_stage: stageId, p_direction: direction } as never,
  );
  if (error || data !== true)
    return { ok: false, error: error?.message ?? "A etapa já está no limite." };
  revalidatePath("/app/settings/tenant/pipelines");
  return { ok: true };
}

export async function movePipeline(pipelineId: string, direction: -1 | 1): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth) return { ok: false, error: "Sem permissão." };
  const { supabase } = auth;
  const { data, error } = await supabase.rpc(
    "fn_reorder_pipeline" as never,
    { p_pipeline: pipelineId, p_direction: direction } as never,
  );
  if (error || data !== true)
    return { ok: false, error: error?.message ?? "O funil já está no limite." };
  revalidatePath("/app/settings/tenant/pipelines");
  return { ok: true };
}

export async function archivePipelineStage(
  pipelineId: string,
  stageId: string,
  migrateToStageId?: string,
): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth) return { ok: false, error: "Sem permissão." };
  const { user, org, supabase } = auth;
  const { count } = await supabase
    .from("crm_leads")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.orgId)
    .eq("stage_id", stageId);
  if ((count ?? 0) > 0 && !migrateToStageId)
    return {
      ok: false,
      error: `Esta etapa possui ${count} negócio(s). Escolha outra etapa para migrar antes de arquivar.`,
    };
  const { error } = await supabase.rpc(
    "fn_archive_pipeline_stage" as never,
    { p_pipeline: pipelineId, p_stage: stageId, p_target: migrateToStageId ?? null } as never,
  );
  if (error) return { ok: false, error: error.message };
  await audit({
    action: "pipeline.stage_archived",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "pipeline_stage",
    resourceId: stageId,
    metadata: {
      pipeline_id: pipelineId,
      migrated_to: migrateToStageId ?? null,
      lead_count: count ?? 0,
    },
  });
  revalidatePath("/app/settings/tenant/pipelines");
  return { ok: true };
}

export async function archivePipeline(pipelineId: string): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth) return { ok: false, error: "Sem permissão." };
  const { org, supabase } = auth;
  const { data: pipeline } = await supabase
    .from("crm_pipelines")
    .select("id,is_default")
    .eq("id", pipelineId)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (!pipeline) return { ok: false, error: "Funil não encontrado." };
  if (pipeline.is_default)
    return {
      ok: false,
      error: "O funil padrão não pode ser arquivado. Defina outro como padrão primeiro.",
    };
  const { count } = await supabase
    .from("crm_leads")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.orgId)
    .eq("pipeline_id", pipelineId);
  if ((count ?? 0) > 0)
    return {
      ok: false,
      error: `Este funil possui ${count} negócio(s). Migre-os antes de arquivar.`,
    };
  const { error } = await supabase
    .from("crm_pipelines")
    .update({ is_archived: true, updated_at: new Date().toISOString() })
    .eq("id", pipelineId)
    .eq("organization_id", org.orgId)
    .eq("is_default", false);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/settings/tenant/pipelines");
  return { ok: true };
}
