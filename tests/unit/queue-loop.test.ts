import { describe, expect, it, vi } from "vitest";

import { queueLoopDelay, runQueueLoop } from "@/lib/agent-engine/queue/loop";

const intervals = { idleMs: 2_000, retryMs: 250 };

describe("queue loop", () => {
  it("uses the idle ceiling for an empty queue and wakes for scheduled work", () => {
    expect(queueLoopDelay(null, intervals)).toBe(2_000);
    expect(queueLoopDelay(8_000, intervals)).toBe(2_000);
    expect(queueLoopDelay(800, intervals)).toBe(800);
    expect(queueLoopDelay(0, intervals)).toBe(250);
  });

  it("does not reopen a claim transaction on every empty round", async () => {
    const claim = vi.fn(async () => [] as string[]);
    const clock = vi.fn(async () => null);
    const sleeps: number[] = [];
    let rounds = 0;

    await runQueueLoop({
      clock,
      claim,
      onClaim: () => {
        rounds += 1;
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      shouldStop: () => rounds >= 4,
      intervals,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(claim).toHaveBeenCalledTimes(1);
    expect(clock).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([250, 2_000, 2_000, 2_000]);
  });

  it("ends cleanly when an abortable sleep rejects during shutdown", async () => {
    await expect(
      runQueueLoop({
        clock: async () => null,
        claim: async () => [],
        onClaim: () => undefined,
        sleep: async () => {
          throw new Error("aborted");
        },
        shouldStop: () => false,
        intervals,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }),
    ).resolves.toBeUndefined();
  });
});
