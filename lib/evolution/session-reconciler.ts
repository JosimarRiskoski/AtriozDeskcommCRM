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
         set status = $2,
             status_reason = case when $2 = 'WORKING' then null else status_reason end,
             last_health_check_at = now(),
             last_status_change_at = now(),
             updated_at = now()
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

async function refreshEvolutionWebhooks(
  pool: pg.Pool,
  config: { baseUrl: string; apiKey: string; appUrl?: string; webhookSecret?: string },
  log: Logger,
): Promise<void> {
  if (!config.appUrl || !config.webhookSecret) {
    log.warn("watchdog Evolution: webhook não reaplicado por falta de URL/segredo", {});
    return;
  }
  const { rows } = await pool.query<{
    id: string;
    external_session_name: string;
    webhook_path_token: string | null;
  }>(
    `select id, external_session_name, webhook_path_token
     from channel_sessions
     where provider = 'evolution' and archived_at is null`,
  );
  const client = new EvolutionClient(config.baseUrl, config.apiKey);
  for (const session of rows) {
    if (!session.webhook_path_token) continue;
    try {
      await client.setWebhook(session.external_session_name, {
        webhookUrl: `${config.appUrl.replace(/\/$/, "")}/api/v1/webhooks/evolution/${session.webhook_path_token}`,
        webhookHeaders: { "x-atrios-evolution-secret": config.webhookSecret },
      });
    } catch (error) {
      log.warn("watchdog Evolution: falha ao reaplicar webhook leve", {
        channel_session_id: session.id,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 160),
      });
    }
  }
}

export async function runEvolutionSessionWatchdogLoop(
  pool: pg.Pool,
  config: {
    baseUrl: string;
    apiKey: string;
    intervalMs: number;
    appUrl?: string;
    webhookSecret?: string;
  },
  log: Logger,
  signal: AbortSignal,
): Promise<void> {
  // Reaplica uma vez no boot para converter também as conexões existentes ao
  // webhook sem base64. Não repete a cada tick para não pressionar a Evolution.
  await refreshEvolutionWebhooks(pool, config, log);
  while (!signal.aborted) {
    const reconciled = await reconcileEvolutionSessions(pool, config, log);
    if (reconciled > 0) log.info("watchdog Evolution: tick com ação", { reconciled });
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, config.intervalMs);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}
