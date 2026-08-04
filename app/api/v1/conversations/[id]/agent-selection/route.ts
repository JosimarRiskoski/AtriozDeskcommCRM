import { randomUUID } from "node:crypto";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  agent_id: z.string().uuid().nullable(),
  reason: z.string().trim().min(3).max(500),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return fail("validation_failed", "Escolha um agente e informe o motivo.", 422, { requestId });
  const { id } = await params;
  const admin = createAdminClient();
  const { data: conversation } = await admin
    .from("conversations")
    .select("id,selected_agent_id,assignee_kind")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (!conversation) return fail("not_found", "Conversa não encontrada.", 404, { requestId });

  if (parsed.data.agent_id) {
    const { data: agent } = await admin
      .from("ai_agents")
      .select("id,published_version_id,archived_at")
      .eq("id", parsed.data.agent_id)
      .eq("organization_id", authz.org.orgId)
      .maybeSingle();
    if (!agent || agent.archived_at || !agent.published_version_id)
      return fail("agent_not_available", "O agente escolhido não possui versão publicada.", 422, {
        requestId,
      });
  }

  const mode = parsed.data.agent_id ? "manual" : "inherit";
  const { data: updated, error } = await admin
    .from("conversations")
    .update({
      selected_agent_id: parsed.data.agent_id,
      agent_selection_mode: mode,
      agent_selection_reason: parsed.data.reason,
      agent_selected_at: new Date().toISOString(),
      agent_selected_by_user_id: authz.user.id,
    })
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .select(
      "id,selected_agent_id,agent_selection_mode,agent_selection_reason,agent_selected_at,assignee_kind",
    )
    .single();
  if (error) return fail("internal_error", "Não foi possível trocar o agente.", 500, { requestId });

  await admin
    .from("conversation_agent_events")
    .insert({
      organization_id: authz.org.orgId,
      conversation_id: id,
      from_agent_id: conversation.selected_agent_id,
      to_agent_id: parsed.data.agent_id,
      selection_mode: mode,
      reason: parsed.data.reason,
      actor_user_id: authz.user.id,
    });
  await audit({
    action: "conversation.agent_selected",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "conversation",
    resourceId: id,
    requestId,
    metadata: {
      from_agent_id: conversation.selected_agent_id,
      to_agent_id: parsed.data.agent_id,
      mode,
    },
  });
  return ok(
    {
      ...updated,
      effective_now: updated.assignee_kind !== "user",
      message:
        updated.assignee_kind === "user"
          ? "Agente salvo. Ele só poderá atuar quando o atendimento humano terminar."
          : "Agente selecionado para esta conversa.",
    },
    { requestId },
  );
}
