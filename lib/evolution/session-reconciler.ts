/**
 * Reconcilia o estado salvo no CRM com a Evolution. O webhook é o caminho
 * rápido; este loop cobre reinícios ou eventos perdidos sem impedir envios.
 */
import type pg from "pg";

import { EvolutionClient } from "@/lib/evolution/client";

import type { Logger } from "@/lib/agent-engine/obs/logger";

function crmStatus(state: string): string {
  const value = state.toLowerCase();
  if (["open", "connected", "working"].includes(value)) return "WORKING";
  if (value.includes("qr") || value.includes("pair")) return "SCAN_QR_CODE";
  if (value.includes("connect") || value.includes("start")) return "STARTING";
  if (value.includes("fail") || value.includes("error")) return "FAILED";
  return "STOPPED";
}

export async function reconcileEvolutionSessions(
  pool: pg.Pool,
  config: { baseUrl: string; apiKey: string },
  log: Logger,
): Promise<number> {
  const { rows } = await pool.query<{ id: string; external_session_name: string; status: string }>(
    `select id, external_session_name, status
     from channel_sessions
     where provider = 'evolution' and archived_at is null`,
  );
  const client = new EvolutionClient(config.baseUrl, config.apiKey);
  let reconciled = 0;

  for (const session of rows) {
    try {
      const remote = await client.connectionState(session.external_session_name);
      const status = crmStatus(remote.state);
      if (status === session.status) continue;
      await pool.query(
        `update channel_sessions
         set status = $2, last_health_check_at = now(), last_status_change_at = now(), updated_at = now()
         where id = $1`,
        [session.id, status],
      );
      reconciled += 1;
      log.warn("watchdog Evolution: estado de conexão reconciliado", {
        channel_session_id: session.id,
        status,
      });
    } catch (error) {
      log.warn("watchdog Evolution: não foi possível consultar uma conexão", {
        channel_session_id: session.id,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 160),
      });
    }
  }
  return reconciled;
}

export async function runEvolutionSessionWatchdogLoop(
  pool: pg.Pool,
  config: { baseUrl: string; apiKey: string; intervalMs: number },
  log: Logger,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    const reconciled = await reconcileEvolutionSessions(pool, config, log);
    if (reconciled > 0) log.info("watchdog Evolution: tick com ação", { reconciled });
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, config.intervalMs);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }
}
