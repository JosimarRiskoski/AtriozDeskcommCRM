export const PENDING_IDENTITY_MAX_ATTEMPTS = 8;
const PENDING_IDENTITY_BASE_RETRY_MS = 5 * 60 * 1000;
const PENDING_IDENTITY_MAX_RETRY_MS = 6 * 60 * 60 * 1000;

export function pendingIdentityRetryDelayMs(nextAttempt: number): number {
  const exponent = Math.max(0, Math.min(nextAttempt - 1, PENDING_IDENTITY_MAX_ATTEMPTS - 1));
  return Math.min(PENDING_IDENTITY_BASE_RETRY_MS * 2 ** exponent, PENDING_IDENTITY_MAX_RETRY_MS);
}

export function pendingIdentityRetryAt(nextAttempt: number, now = new Date()): string {
  return new Date(now.getTime() + pendingIdentityRetryDelayMs(nextAttempt)).toISOString();
}
