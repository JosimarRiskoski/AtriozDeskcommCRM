import { randomUUID } from "node:crypto";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    name: z.string().trim().min(2).max(120),
    agent_id: z.string().uuid(),
    channel_session_id: z.string().uuid().nullable().default(null),
    contact_source: z.string().trim().min(1).max(120).nullable().default(null),
    stage_id: z.string().uuid().nullable().default(null),
    allow_stage_switch: z.boolean().default(false),
    priority: z.number().int().min(0).max(1000).default(100),
  })
  .refine((value) => value.channel_session_id || value.contact_source || value.stage_id, {
    message: "Informe pelo menos uma condição.",
  })
  .refine((value) => !value.stage_id || value.allow_stage_switch, {
    message: "Habilite a troca por etapa.",
  });

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "ai_agents" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();
  const [rules, agents, channels, stages] = await Promise.all([
    admin
      .from("ai_agent_assignment_rules")
      .select(
        "id,name,agent_id,channel_session_id,contact_source,stage_id,allow_stage_switch,priority,is_active,created_at",
      )
      .eq("organization_id", authz.org.orgId)
      .order("priority", { ascending: false })
      .order("created_at"),
    admin
      .from("ai_agents")
      .select("id,name,published_version_id")
      .eq("organization_id", authz.org.orgId)
      .is("archived_at", null),
    admin
      .from("channel_sessions")
      .select("id,display_name,phone_number,waha_session_name,status")
      .eq("organization_id", authz.org.orgId),
    admin
      .from("crm_stages")
      .select("id,name,pipeline_id,crm_pipelines:pipeline_id(name)")
      .eq("organization_id", authz.org.orgId)
      .eq("is_archived", false),
  ]);
  if (rules.error)
    return fail("internal_error", "Não foi possível carregar as regras.", 500, { requestId });
  return ok(
    {
      rules: rules.data ?? [],
      agents: agents.data ?? [],
      channels: channels.data ?? [],
      stages: stages.data ?? [],
    },
    { requestId },
  );
}

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "ai_agents" });
  if (!authz.ok) return authz.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Regra inválida.", 422, {
      requestId,
    });
  const admin = createAdminClient();
  const [{ data: agent }, channel, stage] = await Promise.all([
    admin
      .from("ai_agents")
      .select("id,published_version_id")
      .eq("organization_id", authz.org.orgId)
      .eq("id", parsed.data.agent_id)
      .maybeSingle(),
    parsed.data.channel_session_id
      ? admin
          .from("channel_sessions")
          .select("id")
          .eq("organization_id", authz.org.orgId)
          .eq("id", parsed.data.channel_session_id)
          .maybeSingle()
      : Promise.resolve({ data: { id: "none" } }),
    parsed.data.stage_id
      ? admin
          .from("crm_stages")
          .select("id")
          .eq("organization_id", authz.org.orgId)
          .eq("id", parsed.data.stage_id)
          .maybeSingle()
      : Promise.resolve({ data: { id: "none" } }),
  ]);
  if (!agent?.published_version_id)
    return fail("agent_not_available", "O agente precisa estar publicado.", 422, { requestId });
  if (!channel.data || !stage.data)
    return fail("invalid_reference", "Conexão ou etapa não pertence à organização.", 422, {
      requestId,
    });
  const { data, error } = await admin
    .from("ai_agent_assignment_rules")
    .insert({ organization_id: authz.org.orgId, ...parsed.data, created_by_user_id: authz.user.id })
    .select(
      "id,name,agent_id,channel_session_id,contact_source,stage_id,allow_stage_switch,priority,is_active,created_at",
    )
    .single();
  if (error) return fail("internal_error", "Não foi possível criar a regra.", 500, { requestId });
  return ok(data, { requestId, status: 201 });
}
