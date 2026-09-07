import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let resolveAuthentication: ((value: boolean) => void) | undefined;
const subscribe = vi.fn();
const channel = {
  on: vi.fn().mockReturnThis(),
  subscribe,
};

vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(),
  }),
  authenticateRealtime: () =>
    new Promise<boolean>((resolve) => {
      resolveAuthentication = resolve;
    }),
}));

import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";

describe("autenticação do Realtime", () => {
  beforeEach(() => {
    subscribe.mockClear();
    channel.on.mockClear().mockReturnThis();
    resolveAuthentication = undefined;
  });

  it("não assina um canal antes de aplicar o token de sessão no socket", async () => {
    renderHook(() =>
      useRealtimeChannel({
        name: "test-channel",
        postgresChanges: { event: "*", table: "conversations" },
        onChange: vi.fn(),
      }),
    );

    expect(subscribe).not.toHaveBeenCalled();

    act(() => resolveAuthentication?.(true));
    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));
  });
});
