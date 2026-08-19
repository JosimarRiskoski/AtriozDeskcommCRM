import { describe, expect, it } from "vitest";

import { nextQueuePollDelayMs } from "@/lib/agent-engine/queue/poll-backoff";

describe("backoff ocioso da fila do agente", () => {
  it("cresce progressivamente até o teto", () => {
    expect(nextQueuePollDelayMs(1_000, 1_000, 10_000, false)).toBe(2_000);
    expect(nextQueuePollDelayMs(2_000, 1_000, 10_000, false)).toBe(4_000);
    expect(nextQueuePollDelayMs(8_000, 1_000, 10_000, false)).toBe(10_000);
    expect(nextQueuePollDelayMs(10_000, 1_000, 10_000, false)).toBe(10_000);
  });

  it("volta imediatamente ao intervalo base quando encontra trabalho", () => {
    expect(nextQueuePollDelayMs(10_000, 1_000, 10_000, true)).toBe(1_000);
  });
});
