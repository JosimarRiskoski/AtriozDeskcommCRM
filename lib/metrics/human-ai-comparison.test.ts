import { describe, expect, it } from "vitest";
import { summarizeServiceMode } from "./human-ai-comparison";

describe("human x AI comparison", () => {
  it("calculates outcome, time, cost and quality", () => {
    const result = summarizeServiceMode([
      {
        mode: "ai",
        firstResponseSeconds: 5,
        resolutionSeconds: 60,
        converted: true,
        handoff: false,
        reopened: false,
        costCents: 12,
      },
      {
        mode: "ai",
        firstResponseSeconds: 15,
        resolutionSeconds: null,
        converted: false,
        handoff: true,
        reopened: false,
        costCents: 8,
      },
    ]);
    expect(result).toMatchObject({
      conversations: 2,
      avg_first_response_seconds: 10,
      resolved: 1,
      converted: 1,
      handoffs: 1,
      cost_cents: 20,
    });
    expect(result.quality_score).toBeGreaterThanOrEqual(0);
  });

  it("does not invent human cost when hourly cost is not configured", () => {
    expect(
      summarizeServiceMode([
        {
          mode: "human",
          firstResponseSeconds: 20,
          resolutionSeconds: 100,
          converted: false,
          handoff: false,
          reopened: false,
          costCents: null,
        },
      ]).cost_cents,
    ).toBeNull();
  });
});
