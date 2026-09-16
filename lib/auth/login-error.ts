type AuthFailure = { status?: number; code?: string; name?: string };

export function classifyLoginError(error: AuthFailure | null):
  "invalid_credentials" | "rate_limited" | "service_unavailable" {
  if (error?.status === 429) return "rate_limited";
  if (error && (error.status === 0 || (error.status ?? 0) >= 500 || error.name === "AuthRetryableFetchError")) {
    return "service_unavailable";
  }
  // Keep account-specific failures indistinguishable to prevent enumeration.
  return "invalid_credentials";
}
