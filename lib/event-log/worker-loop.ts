import { setTimeout as sleep } from "node:timers/promises";

import type { SupabaseClient } from "@supabase/supabase-js";

import { drainEventLog, type DrainSummary } from "@/lib/event-log/drain";
import { ensureHandlersRegistered } from "@/lib/event-log/register-handlers";
import type { Logger } from "@/lib/agent-engine/obs/logger";

export interface EventLogWorkerLoopConfig {
  batchSize: number;
  idleIntervalMs: number;
  busyIntervalMs: number;
}

/**
 * Consome os eventos genéricos fora do processo HTTP. Assim, IA, mídia e
 * automações não competem com o Inbox e nem deixam um webhook aguardando a UI.
 */
export async function runEventLogWorkerLoop(
  admin: SupabaseClient,
  config: EventLogWorkerLoopConfig,
  log: Logger,
  signal: AbortSignal,
  drain: (client: SupabaseClient, opts: { limit: number }) => Promise<DrainSummary> = drainEventLog,
): Promise<void> {
  ensureHandlersRegistered();

  while (!signal.aborted) {
    try {
      const summary = await drain(admin, { limit: config.batchSize });
      const active = summary.scanned > 0;
      if (active) {
        log.info("event-log: lote processado no worker", { ...summary });
      }
      await sleep(active ? config.busyIntervalMs : config.idleIntervalMs, undefined, { signal });
    } catch (error) {
      if (signal.aborted) break;
      const detail = error instanceof Error ? error.message : String(error);
      log.error("event-log: loop falhou — tenta no próximo ciclo", { error: detail.slice(0, 300) });
      try {
        await sleep(config.idleIntervalMs, undefined, { signal });
      } catch {
        break;
      }
    }
  }
}
