import type pg from "pg";

export interface WebhookLogRetentionResult {
  deleted: number;
  batches: number;
}

/**
 * Limpa logs tecnicos em lotes curtos para evitar lock longo e crescimento
 * ilimitado. A funcao SQL aceita somente status=processed e nunca toca nos
 * registros comerciais do CRM.
 */
export async function cleanupProcessedWebhookLogs(
  pool: pg.Pool,
  options: { retentionDays?: number; batchSize?: number; maxBatches?: number } = {},
): Promise<WebhookLogRetentionResult> {
  const retentionDays = options.retentionDays ?? 14;
  const batchSize = options.batchSize ?? 2_000;
  const maxBatches = options.maxBatches ?? 5;
  let deleted = 0;
  let batches = 0;

  for (let index = 0; index < maxBatches; index++) {
    const result = await pool.query<{ deleted: number }>(
      `select public.fn_cleanup_processed_webhook_logs(
         make_interval(days => $1::int),
         $2::int
       ) as deleted`,
      [retentionDays, batchSize],
    );
    const current = Number(result.rows[0]?.deleted ?? 0);
    deleted += current;
    batches++;
    if (current < batchSize) break;
  }

  return { deleted, batches };
}
