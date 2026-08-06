const PACING_CODES = new Set(["outside_window", "warmup_cap", "daily_cap"]);

interface RetentionTraceLike {
  created_at: string;
  vetoed_code: string | null;
}

/**
 * Uma alteração na proteção do número invalida avisos antigos de pacing. Outros
 * vetos (LGPD, qualidade e casos humanos) não dependem desses knobs e continuam
 * visíveis normalmente.
 */
export function visibleRetentionTraces<T extends RetentionTraceLike>(
  traces: T[],
  pacingUpdatedAt: string | null | undefined,
): T[] {
  if (!pacingUpdatedAt) return traces;
  const changedAt = Date.parse(pacingUpdatedAt);
  if (!Number.isFinite(changedAt)) return traces;

  return traces.filter((trace) => {
    if (!trace.vetoed_code || !PACING_CODES.has(trace.vetoed_code)) return true;
    const retainedAt = Date.parse(trace.created_at);
    return !Number.isFinite(retainedAt) || retainedAt >= changedAt;
  });
}
