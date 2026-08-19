import type { Logger } from "../obs/logger";

export interface QueueLoopIntervals {
  /** Teto da espera quando a fila esta vazia ou o proximo job ainda nao venceu. */
  idleMs: number;
  /** Ritmo curto quando existe job vencido aguardando uma vaga/lane. */
  retryMs: number;
}

export function queueLoopDelay(
  millisecondsUntilNextJob: number | null,
  intervals: QueueLoopIntervals,
): number {
  if (millisecondsUntilNextJob === null) return intervals.idleMs;
  if (millisecondsUntilNextJob <= 0) return intervals.retryMs;
  return Math.min(millisecondsUntilNextJob, intervals.idleMs);
}

export interface QueueLoopDeps<Job> {
  clock: () => Promise<number | null>;
  claim: () => Promise<Job[]>;
  onClaim: (jobs: Job[]) => void;
  sleep: (ms: number) => Promise<unknown>;
  shouldStop: () => boolean;
  intervals: QueueLoopIntervals;
  log: Logger;
}

/**
 * Consulta um relogio barato antes de abrir a transacao de claim. Assim uma
 * instalacao ociosa deixa de executar begin/lock/count/claim/commit sem trabalho.
 * O loop resolve, em vez de rejeitar, para preservar o drain no shutdown.
 */
export async function runQueueLoop<Job>(deps: QueueLoopDeps<Job>): Promise<void> {
  let previousClaimHadJobs = true;

  while (!deps.shouldStop()) {
    let millisecondsUntilNextJob: number | null = 0;
    if (!previousClaimHadJobs) {
      try {
        millisecondsUntilNextJob = await deps.clock();
      } catch (error) {
        deps.log.error("relogio da fila indisponivel; claim mantido no ritmo curto", {
          error: (error instanceof Error ? error.message : String(error)).slice(0, 300),
        });
        millisecondsUntilNextJob = 0;
      }
    }

    let claimed: Job[] = [];
    if (millisecondsUntilNextJob !== null && millisecondsUntilNextJob <= 0) {
      try {
        claimed = await deps.claim();
      } catch (error) {
        deps.log.error("claim falhou", {
          error: (error instanceof Error ? error.message : String(error)).slice(0, 300),
        });
      }
    }

    deps.onClaim(claimed);
    previousClaimHadJobs = claimed.length > 0;

    if (claimed.length === 0 || deps.shouldStop()) {
      try {
        await deps.sleep(queueLoopDelay(millisecondsUntilNextJob, deps.intervals));
      } catch {
        break;
      }
    }
  }
}
