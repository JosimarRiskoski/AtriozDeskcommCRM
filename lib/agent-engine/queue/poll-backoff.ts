/** Recuo do consumidor da fila quando não existe trabalho. */
export function nextQueuePollDelayMs(
  currentMs: number,
  baseMs: number,
  maxMs: number,
  workFound: boolean,
): number {
  if (workFound) return baseMs;
  return Math.min(Math.max(currentMs, baseMs) * 2, maxMs);
}
