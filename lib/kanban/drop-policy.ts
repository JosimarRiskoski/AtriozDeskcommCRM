import type { Lead } from "@/lib/types/leads";
import type { Stage } from "@/lib/kanban/types";

export function shouldRequestLostReason(lead: Lead, destination: Stage): boolean {
  return destination.is_lost && lead.status !== "lost";
}
