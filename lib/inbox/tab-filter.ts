import type { ConversationsFilters } from "@/hooks/inbox/useConversationsRealtime";

export type InboxTab = "unassigned" | "mine" | "all" | "closed" | "ai";

/**
 * Cada aba precisa representar a mesma regra usada pelos contadores e pelo
 * roteamento. Em especial, Fila significa conversa aberta sem humano dono.
 */
export function inboxTabToFilter(tab: InboxTab): Partial<ConversationsFilters> {
  switch (tab) {
    case "unassigned":
      return { assigned_to: "unassigned", status: "open" };
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
