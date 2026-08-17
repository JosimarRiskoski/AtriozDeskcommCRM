import { describe, expect, it } from "vitest";

import {
  PENDING_IDENTITY_MAX_ATTEMPTS,
  pendingIdentityRetryDelayMs,
} from "@/lib/evolution/pending-recovery-policy";

describe("pendingIdentityRetryDelayMs", () => {
  it("aplica backoff exponencial a partir de cinco minutos", () => {
    expect(pendingIdentityRetryDelayMs(1)).toBe(5 * 60 * 1000);
    expect(pendingIdentityRetryDelayMs(2)).toBe(10 * 60 * 1000);
    expect(pendingIdentityRetryDelayMs(3)).toBe(20 * 60 * 1000);
  });

  it("limita o intervalo a seis horas", () => {
    expect(pendingIdentityRetryDelayMs(PENDING_IDENTITY_MAX_ATTEMPTS)).toBe(6 * 60 * 60 * 1000);
    expect(pendingIdentityRetryDelayMs(99)).toBe(6 * 60 * 60 * 1000);
  });
});
