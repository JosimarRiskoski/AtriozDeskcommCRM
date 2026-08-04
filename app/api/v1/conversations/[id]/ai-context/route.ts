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
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const { id } = await params;
  const supabase = await createClient();
  const { data: conversation, error } = await supabase
    .from("conversations")
    .select(
      "id,contact_id,channel_session_id,selected_agent_id,agent_selection_mode,agent_selection_reason,updated_at",
    )
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (error)
    return fail("internal_error", "Não foi possível ler o contexto da IA.", 500, { requestId });
  if (!conversation) return fail("not_found", "Conversa não encontrada.", 404, { requestId });

  let agentQuery = supabase
    .from("ai_agent_versions")
    .select("agent_id,ai_agents:agent_id(id,name,active_kb_version_id,config)")
    .eq("organization_id", authz.org.orgId)
    .eq("status", "published");
  agentQuery = conversation.selected_agent_id
    ? agentQuery.eq("agent_id", conversation.selected_agent_id)
    : agentQuery.eq("channel_session_id", conversation.channel_session_id);
  const [checkpointResult, notesResult, agentsResult] = await Promise.all([
    supabase
      .from("lead_checkpoints")
      .select("rolling_summary,commitments,objections,next_action,created_at")
      .eq("organization_id", authz.org.orgId)
      .eq("contact_id", conversation.contact_id)
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("lead_notes")
      .select("id,headline,body,created_at")
      .eq("organization_id", authz.org.orgId)
      .eq("contact_id", conversation.contact_id)
      .order("created_at", { ascending: false })
      .limit(50),
    agentQuery.limit(1).maybeSingle(),
  ]);

  const embedded = <T>(value: T | T[] | null): T | null =>
    Array.isArray(value) ? (value[0] ?? null) : value;
  const version = agentsResult.data as unknown as {
    agent_id: string;
    ai_agents:
      | {
          id: string;
          name: string;
          active_kb_version_id: string | null;
          config: Record<string, unknown> | null;
        }
      | Array<{
          id: string;
          name: string;
          active_kb_version_id: string | null;
          config: Record<string, unknown> | null;
        }>
      | null;
  } | null;
  const agent = version ? embedded(version.ai_agents) : null;
  const knowledgeEnabled = agent?.config?.knowledge_base_enabled !== false;
  const { data: sources } =
    agent && knowledgeEnabled
      ? await supabase
          .from("ai_knowledge_sources")
          .select("id,name,source_type,status,updated_at")
          .eq("organization_id", authz.org.orgId)
          .eq("agent_id", agent.id)
          .eq("is_active", true)
          .order("name")
      : { data: [] };
  const checkpoint = checkpointResult.data;
  const notes = notesResult.data ?? [];
  const updatedCandidates = [
    conversation.updated_at,
    checkpoint?.created_at,
    ...notes.map((note) => note.created_at),
    ...(sources ?? []).map((source) => source.updated_at),
  ].filter((value): value is string => Boolean(value));

  return ok(
    {
      summary: checkpoint?.rolling_summary || null,
      commitments: Array.isArray(checkpoint?.commitments) ? checkpoint.commitments : [],
      objections: Array.isArray(checkpoint?.objections) ? checkpoint.objections : [],
      next_action: checkpoint?.next_action ?? null,
      notes,
      sources: sources ?? [],
      agent: agent ? { id: agent.id, name: agent.name } : null,
      agent_selection_mode: conversation.agent_selection_mode,
      agent_selection_reason: conversation.agent_selection_reason,
      knowledge_enabled: knowledgeEnabled,
      last_updated_at: updatedCandidates.sort().at(-1) ?? null,
    },
    { requestId },
  );
}
