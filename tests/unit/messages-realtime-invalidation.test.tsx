import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let onRealtimeChange: ((payload: unknown) => void) | undefined;

vi.mock("@/hooks/realtime/useRealtimeChannel", () => ({
  useRealtimeChannel: (opts: { onChange: (payload: unknown) => void }) => {
    onRealtimeChange = opts.onChange;
    return { status: "subscribed" };
  },
}));

vi.mock("@/lib/api/client", () => ({
  apiClient: { get: vi.fn() },
}));

import { useMessagesRealtime } from "@/hooks/inbox/useMessagesRealtime";

function wrapperFor(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("Realtime da conversa aberta", () => {
  beforeEach(() => {
    onRealtimeChange = undefined;
  });

  it("atualiza o histórico sem disparar outra leitura da lista de conversas", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useMessagesRealtime("conversation-1"), {
      wrapper: wrapperFor(queryClient),
    });

    act(() => onRealtimeChange?.({ id: "message-1" }));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["messages", "conversation-1"] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["conversations"] });
  });
});
