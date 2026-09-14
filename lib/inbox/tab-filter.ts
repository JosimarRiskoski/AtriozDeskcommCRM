import type { ConversationsFilters } from "@/hooks/inbox/useConversationsRealtime";

export type InboxTab = "unassigned" | "mine" | "all" | "closed" | "ai";

/**
 * Cada aba precisa representar a mesma regra usada pelos contadores e pelo
 * roteamento. Em especial, Fila significa atendimento humano pendente: a
 * mesma classificação `waiting` usada pelo contador do banco.
 */
export function inboxTabToFilter(tab: InboxTab): Partial<ConversationsFilters> {
  switch (tab) {
    case "unassigned":
      return { command: "waiting" };
    case "mine":
      return { assigned_to: "me", exclude_finished: true };
    case "closed":
      return { status: "closed" };
    case "ai":
      return { command: "automatic" };
    case "all":
    default:
      return {};
  }
}
