/** Only return local destinations; use identically before and after MFA. */
export function safeNextPath(next?: string): string {
  const fallback = "/app/inbox";
  if (!next?.startsWith("/") || next.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(next)) {
    return fallback;
  }
  try {
    const parsed = new URL(next, "https://atrioz.invalid");
    return parsed.origin === "https://atrioz.invalid"
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}
