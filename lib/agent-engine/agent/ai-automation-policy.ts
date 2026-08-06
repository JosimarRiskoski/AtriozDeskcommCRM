export type ConversationAiMode = "inherit" | "force_active" | "force_paused";

export type InboundAiPolicy = {
  mode: ConversationAiMode;
  enabledForAll: boolean;
  humanAttending: boolean;
};

export type InboundAiPolicyDecision =
  { allowed: true } | { allowed: false; reason: "paused" | "general_disabled" | "human_attending" };

/** Regra única e testável que decide se uma mensagem recebida pode acordar a IA. */
export function decideInboundAiPolicy(policy: InboundAiPolicy): InboundAiPolicyDecision {
  if (policy.mode === "force_paused") return { allowed: false, reason: "paused" };
  if (!policy.enabledForAll && policy.mode !== "force_active") {
    return { allowed: false, reason: "general_disabled" };
  }
  if (policy.humanAttending) return { allowed: false, reason: "human_attending" };
  return { allowed: true };
}
