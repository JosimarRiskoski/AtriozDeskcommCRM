import { describe, expect, it } from "vitest";
import { distributeCampaignRecipients, estimateCampaignSchedule } from "./distribution";

describe("campaign distribution", () => {
  it("balances recipients and respects capacity", () => {
    const recipients = Array.from({ length: 7 }, (_, index) => ({ key: `+55119999900${index}` }));
    const result = distributeCampaignRecipients(
      recipients,
      [
        { id: "a", label: "A", remainingCapacity: 2 },
        { id: "b", label: "B", remainingCapacity: 4 },
      ],
      "campaign",
    );
    expect(result.assignments).toHaveLength(6);
    expect(result.excludedByCapacity).toHaveLength(1);
    expect(result.counts).toEqual({ a: 2, b: 4 });
  });

  it("keeps the same assignment for the same seed", () => {
    const recipients = [{ key: "1" }, { key: "2" }, { key: "3" }];
    const connections = [
      { id: "a", label: "A", remainingCapacity: 10 },
      { id: "b", label: "B", remainingCapacity: 10 },
    ];
    expect(distributeCampaignRecipients(recipients, connections, "x").assignments).toEqual(
      distributeCampaignRecipients(recipients, connections, "x").assignments,
    );
  });

  it("includes overnight pauses in the forecast", () => {
    const estimate = estimateCampaignSchedule({
      now: new Date("2026-08-03T12:00:00Z"),
      timezone: "America/Sao_Paulo",
      businessStart: "08:00",
      businessEnd: "18:00",
      intervalSeconds: 3600,
      counts: { a: 12 },
    });
    expect(estimate.activeSendingSeconds).toBe(11 * 3600);
    expect(estimate.durationSeconds).toBeGreaterThan(estimate.activeSendingSeconds);
  });

  it("does not promise parallel sending while the worker uses a global interval", () => {
    const estimate = estimateCampaignSchedule({
      now: new Date("2026-08-03T12:00:00Z"),
      timezone: "America/Sao_Paulo",
      businessStart: "08:00",
      businessEnd: "18:00",
      intervalSeconds: 300,
      counts: { a: 3, b: 3 },
    });
    expect(estimate.totalRecipients).toBe(6);
    expect(estimate.activeSendingSeconds).toBe(5 * 300);
    expect(estimate.executionMode).toBe("global_interval");
  });
});
