import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/event-log/register-handlers", () => ({ ensureHandlersRegistered: vi.fn() }));

import { ensureHandlersRegistered } from "@/lib/event-log/register-handlers";
import { runEventLogWorkerLoop } from "@/lib/event-log/worker-loop";

describe("runEventLogWorkerLoop", () => {
  it("registra os handlers e drena em lotes pequenos fora do processo web", async () => {
    const controller = new AbortController();
    const drain = vi.fn(async () => {
      controller.abort();
      return { scanned: 1, done: 1, retried: 0, failed: 0, dead: 0 };
    });
    const log = { info: vi.fn(), error: vi.fn() };

    await runEventLogWorkerLoop({} as never, {
      batchSize: 10,
      busyIntervalMs: 1,
      idleIntervalMs: 1,
    }, log as never, controller.signal, drain);

    expect(ensureHandlersRegistered).toHaveBeenCalledOnce();
    expect(drain).toHaveBeenCalledWith({}, { limit: 10 });
    expect(log.info).toHaveBeenCalledWith("event-log: lote processado no worker", expect.objectContaining({ scanned: 1 }));
  });
});
