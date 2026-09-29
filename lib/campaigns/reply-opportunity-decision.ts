export type ReplyOpportunityDecision = "create" | "move" | "link_only";

/**
 * Nenhuma resposta inbound pode criar dois cards. Quando ja houver um negocio
 * aberto, somente o card do mesmo funil pode ser movido: move-lo entre funis
 * violaria a regra de imutabilidade do Kanban.
 */
export function decideReplyOpportunityAction(input: {
  activeLead: { pipeline_id: string } | null;
  targetPipelineId: string;
}): ReplyOpportunityDecision {
  if (!input.activeLead) return "create";
  return input.activeLead.pipeline_id === input.targetPipelineId ? "move" : "link_only";
}
