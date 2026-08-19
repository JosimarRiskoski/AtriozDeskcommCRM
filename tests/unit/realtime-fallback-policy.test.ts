import { describe, expect, it } from "vitest";

import {
  REALTIME_FALLBACK_DEGRADED_MS,
  REALTIME_FALLBACK_HEALTHY_MS,
  realtimeFallbackIntervalMs,
} from "@/hooks/realtime/fallback-policy";

describe("política de recuperação do Realtime", () => {
  it("faz somente uma conferência por minuto quando o canal está saudável", () => {
    expect(realtimeFallbackIntervalMs("subscribed")).toBe(REALTIME_FALLBACK_HEALTHY_MS);
    expect(REALTIME_FALLBACK_HEALTHY_MS).toBe(60_000);
  });

  it.each(["connecting", "channel_error", "timed_out", "closed"] as const)(
    "acelera temporariamente quando o canal está %s",
    (status) => {
      expect(realtimeFallbackIntervalMs(status)).toBe(REALTIME_FALLBACK_DEGRADED_MS);
    },
  );
});
