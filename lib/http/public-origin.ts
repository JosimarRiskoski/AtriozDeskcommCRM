type HeaderReader = Pick<Headers, "get">;

function firstForwardedValue(value: string | null): string | null {
  return value?.split(",")[0]?.trim() || null;
}

/** Resolve o domínio público quando o Next roda atrás de proxy reverso. */
export function resolvePublicOrigin(headers: HeaderReader, fallback?: string): string | undefined {
  const host =
    firstForwardedValue(headers.get("x-forwarded-host")) ??
    firstForwardedValue(headers.get("host"));
  const proto = firstForwardedValue(headers.get("x-forwarded-proto")) ?? "https";
  if (host) return `${proto}://${host}`;
  return fallback;
}
