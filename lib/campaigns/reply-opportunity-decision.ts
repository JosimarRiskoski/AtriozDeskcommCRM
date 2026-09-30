export type ReplyOpportunityDecision = "create" | "move" | "link_only";

export function campaignReplyLeadTitle(contact: {
  name: string | null;
  display_name: string | null;
  phone_number: string | null;
}): string {
  const name = contact.display_name?.trim() || contact.name?.trim();
  const phone = contact.phone_number?.trim();
  return [name, phone].filter(Boolean).join(" · ") || "Contato da campanha";
}

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
