import { describe, expect, it, vi } from "vitest";

import {
  dispatchEvent,
  registerHandler,
  type EventRow,
} from "@/lib/event-log/dispatcher";

const row: EventRow = {
  id: "event-1",
  organization_id: "org-1",
  event_type: "test.parallel",
  entity_kind: "test",
  entity_id: null,
  payload: {},
  metadata: {},
  consumed_by: [],
  attempts: 0,
};

describe("event dispatcher", () => {
  it("starts independent consumers together and preserves the result order", async () => {
    let releaseSlow!: () => void;
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const fast = vi.fn(async () => ({ consumer_key: "parallel-fast", status: "ok" as const }));

    registerHandler({
      key: "parallel-slow",
      events: ["test.parallel"],
      handle: async () => {
        await slow;
        return { consumer_key: "parallel-slow", status: "ok" };
      },
    });
    registerHandler({ key: "parallel-fast", events: ["test.parallel"], handle: fast });

    const pending = dispatchEvent(row);
    await vi.waitFor(() => expect(fast).toHaveBeenCalledTimes(1));
    releaseSlow();

    await expect(pending).resolves.toEqual([
      { consumer_key: "parallel-slow", status: "ok" },
      { consumer_key: "parallel-fast", status: "ok" },
    ]);
  });
});
