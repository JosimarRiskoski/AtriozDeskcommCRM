export type ByteRange = { start: number; end: number };

/**
 * Resolve um único intervalo HTTP em bytes. Retorna `null` quando não há um
 * Range reconhecível e `"unsatisfiable"` quando o intervalo é válido na forma,
 * mas não cabe no recurso.
 */
export function resolveByteRange(
  header: string | null,
  totalBytes: number,
): ByteRange | null | "unsatisfiable" {
  const match = header?.trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) return null;
  if (!Number.isInteger(totalBytes) || totalBytes <= 0) return "unsatisfiable";

  const rawStart = match[1] ?? "";
  const rawEnd = match[2] ?? "";
  if (!rawStart && !rawEnd) return "unsatisfiable";

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return "unsatisfiable";
    return { start: Math.max(0, totalBytes - suffixLength), end: totalBytes - 1 };
  }

  const start = Number(rawStart);
  const requestedEnd = rawEnd ? Number(rawEnd) : totalBytes - 1;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= totalBytes
  ) {
    return "unsatisfiable";
  }
  return { start, end: Math.min(requestedEnd, totalBytes - 1) };
}
