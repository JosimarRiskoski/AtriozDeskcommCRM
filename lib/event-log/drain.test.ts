import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/event-log/dispatcher", () => ({
  getRegisteredHandlers: () => [{ key: "test", events: ["message.received"] }],
  dispatchEvent: vi.fn(async () => []),
}));

import { dispatchEvent } from "@/lib/event-log/dispatcher";
import { drainEventLog } from "@/lib/event-log/drain";

function query(result: { data: unknown; error: { message: string } | null }) {
  const builder = {
    select: vi.fn(() => builder),
    update: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    or: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return builder;
}

describe("drainEventLog: leitura leve antes do payload", () => {
  beforeEach(() => vi.clearAllMocks());

  it("não busca payload quando a fila está vazia", async () => {
    const candidates = query({ data: [], error: null });
    const from = vi.fn(() => candidates);

    const summary = await drainEventLog({ from } as unknown as SupabaseClient, { limit: 10 });

    expect(summary.scanned).toBe(0);
    expect(from).toHaveBeenCalledTimes(1);
    expect(candidates.select).toHaveBeenCalledWith("id, created_at");
    expect(candidates.limit).toHaveBeenCalledWith(10);
  });

  it("busca somente os IDs escolhidos e preserva a ordem do lote", async () => {
    const first = query({
      data: [{ id: "old" }, { id: "new" }],
      error: null,
    });
    const full = query({
      data: [
        { id: "new", event_type: "message.received", consumed_by: [], attempts: 0 },
        { id: "old", event_type: "message.received", consumed_by: [], attempts: 0 },
      ],
      error: null,
    });
    const claimOld = query({ data: [{ id: "old" }], error: null });
    const doneOld = query({ data: null, error: null });
    const claimNew = query({ data: [{ id: "new" }], error: null });
    const doneNew = query({ data: null, error: null });
    const from = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(full)
      .mockReturnValueOnce(claimOld)
      .mockReturnValueOnce(doneOld)
      .mockReturnValueOnce(claimNew)
      .mockReturnValueOnce(doneNew);

    const summary = await drainEventLog({ from } as unknown as SupabaseClient, { limit: 2 });

    expect(summary).toMatchObject({ scanned: 2, done: 2 });
    expect(full.in).toHaveBeenCalledWith("id", ["old", "new"]);
    expect(vi.mocked(dispatchEvent).mock.calls.map(([row]) => row.id)).toEqual(["old", "new"]);
  });

  it("não reivindica eventos se a busca de payload falhar", async () => {
    const first = query({ data: [{ id: "one" }], error: null });
    const full = query({ data: null, error: { message: "timeout" } });
    const from = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(full);

    const summary = await drainEventLog({ from } as unknown as SupabaseClient);

    expect(summary.scanned).toBe(0);
    expect(from).toHaveBeenCalledTimes(2);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
