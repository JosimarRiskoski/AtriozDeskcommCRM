import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const postMock = vi.fn();
const warningMock = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiClient: { post: (...args: unknown[]) => postMock(...args) },
}));
vi.mock("sonner", () => ({ toast: { warning: (...args: unknown[]) => warningMock(...args) } }));

import { useMarkConversationRead } from "@/hooks/inbox/useMarkConversationRead";

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(["conversations", "all"], {
    pages: [
      {
        data: [
          { id: "conv-1", unread_count_for_assignee: 3 },
          { id: "conv-2", unread_count_for_assignee: 2 },
        ],
      },
    ],
    pageParams: [null],
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useMarkConversationRead(), { wrapper });
  return { queryClient, hook };
}

describe("useMarkConversationRead", () => {
  beforeEach(() => {
    postMock.mockReset();
    warningMock.mockReset();
  });

  it("zera apenas a conversa selecionada e chama o endpoint correto", async () => {
    postMock.mockResolvedValue({
      data: { marked_messages: 3, unread_count: 0, receipt_synced: true, receipt_warning: null },
    });
    const { queryClient, hook } = setup();

    await act(async () => {
      await hook.result.current.mutateAsync("conv-1");
    });

    const cache = queryClient.getQueryData<{
      pages: Array<{ data: Array<{ id: string; unread_count_for_assignee: number }> }>;
    }>(["conversations", "all"]);
    expect(postMock).toHaveBeenCalledWith("/api/v1/conversations/conv-1/read", {});
    expect(cache?.pages[0]?.data).toEqual([
      { id: "conv-1", unread_count_for_assignee: 0 },
      { id: "conv-2", unread_count_for_assignee: 2 },
    ]);
  });

  it("restaura o contador quando a persistência local falha", async () => {
    postMock.mockRejectedValue(new Error("db_down"));
    const { queryClient, hook } = setup();

    await act(async () => {
      await expect(hook.result.current.mutateAsync("conv-1")).rejects.toThrow("db_down");
    });

    await waitFor(() => {
      const cache = queryClient.getQueryData<{
        pages: Array<{ data: Array<{ id: string; unread_count_for_assignee: number }> }>;
      }>(["conversations", "all"]);
      expect(cache?.pages[0]?.data[0]?.unread_count_for_assignee).toBe(3);
    });
  });

  it("avisa quando o CRM leu, mas o recibo da Evolution não sincronizou", async () => {
    postMock.mockResolvedValue({
      data: {
        marked_messages: 1,
        unread_count: 0,
        receipt_synced: false,
        receipt_warning: "Recibo pendente",
      },
    });
    const { hook } = setup();

    await act(async () => {
      await hook.result.current.mutateAsync("conv-1");
    });

    expect(warningMock).toHaveBeenCalledWith("Recibo pendente");
  });
});
