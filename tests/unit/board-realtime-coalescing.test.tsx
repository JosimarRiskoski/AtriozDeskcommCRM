import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let onRealtimeChange: ((payload: unknown) => void) | undefined;

vi.mock("@/hooks/realtime/useRealtimeChannel", () => ({
  useRealtimeChannel: (opts: { onChange: (payload: unknown) => void }) => {
    onRealtimeChange = opts.onChange;
    return { status: "subscribed", ultimaEntrega: { current: null } };
  },
}));

vi.mock("@/hooks/realtime/useRefetchDeSeguranca", () => ({
  useRefetchDeSeguranca: () => ({
    divergencias: 0,
    ultimaDivergencia: null,
    ultimaVerificacao: null,
  }),
}));

vi.mock("@/lib/api/client", () => ({
  apiClient: { get: vi.fn().mockResolvedValue({ data: { leads: [], stages: [] } }) },
}));

import { useBoard } from "@/hooks/kanban/useBoard";

function wrapperFor(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("Realtime do Kanban", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    onRealtimeChange = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reconcilia uma cascata de eventos com uma única leitura do board", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useBoard("pipeline-1"), {
      wrapper: wrapperFor(queryClient),
    });

    act(() => {
      onRealtimeChange?.({ new: { id: "lead-1" } });
      onRealtimeChange?.({ new: { id: "lead-1" } });
      vi.advanceTimersByTime(249);
    });
    expect(invalidate).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["board", "pipeline-1"] });
  });
});
