export type ServiceMode = "human" | "ai";
export type ConversationPerformanceFact = {
  mode: ServiceMode;
  firstResponseSeconds: number | null;
  resolutionSeconds: number | null;
  converted: boolean;
  handoff: boolean;
  reopened: boolean;
  costCents: number | null;
};

export function summarizeServiceMode(facts: ConversationPerformanceFact[]) {
  const average = (values: number[]) =>
    values.length
      ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
      : null;
  const firstResponses = facts
    .map((fact) => fact.firstResponseSeconds)
    .filter((value): value is number => value !== null);
  const resolutions = facts
    .map((fact) => fact.resolutionSeconds)
    .filter((value): value is number => value !== null);
  const resolved = resolutions.length;
  const converted = facts.filter((fact) => fact.converted).length;
  const handoffs = facts.filter((fact) => fact.handoff).length;
  const reopened = facts.filter((fact) => fact.reopened).length;
  const knownCosts = facts
    .map((fact) => fact.costCents)
    .filter((value): value is number => value !== null);
  const resolutionRate = facts.length ? resolved / facts.length : 0;
  const conversionRate = facts.length ? converted / facts.length : 0;
  const reopenRate = resolved ? reopened / resolved : 0;
  const handoffPenalty = facts[0]?.mode === "ai" && facts.length ? handoffs / facts.length : 0;
  const qualityScore = facts.length
    ? Math.round(
        Math.max(
          0,
          Math.min(
            100,
            (resolutionRate * 0.55 +
              conversionRate * 0.35 -
              reopenRate * 0.2 -
              handoffPenalty * 0.1 +
              0.1) *
              100,
          ),
        ),
      )
    : null;
  return {
    conversations: facts.length,
    avg_first_response_seconds: average(firstResponses),
    avg_resolution_seconds: average(resolutions),
    resolved,
    converted,
    handoffs,
    reopened,
    cost_cents:
      knownCosts.length === facts.length ? knownCosts.reduce((sum, value) => sum + value, 0) : null,
    quality_score: qualityScore,
  };
}
