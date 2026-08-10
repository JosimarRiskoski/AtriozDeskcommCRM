"use client";

import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";

interface ConversationPage {
  data: ConversationWithContact[];
  meta?: { cursor?: string | null; has_more?: boolean };
}

type Snapshot = Array<[readonly unknown[], InfiniteData<ConversationPage> | undefined]>;

export function useMarkConversationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      apiClient.post<{
        data: {
          marked_messages: number;
          unread_count: number;
          receipt_synced: boolean;
          receipt_warning: string | null;
        };
      }>(
        `/api/v1/conversations/${conversationId}/read`,
        {},
      ),
    onMutate: async (conversationId): Promise<{ snapshot: Snapshot }> => {
      await queryClient.cancelQueries({ queryKey: ["conversations"] });
      const snapshot = queryClient.getQueriesData<InfiniteData<ConversationPage>>({
        queryKey: ["conversations"],
      });
      queryClient.setQueriesData<InfiniteData<ConversationPage>>(
        { queryKey: ["conversations"] },
        (old) =>
          old
            ? {
                ...old,
                pages: old.pages.map((page) => ({
                  ...page,
                  data: page.data.map((conversation) =>
                    conversation.id === conversationId
                      ? { ...conversation, unread_count_for_assignee: 0 }
                      : conversation,
                  ),
                })),
              }
            : old,
      );
      return { snapshot };
    },
    onError: (_error, _conversationId, context) => {
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data);
    },
    onSuccess: (response) => {
      if (!response.data.receipt_synced && response.data.receipt_warning) {
        toast.warning(response.data.receipt_warning);
      }
    },
    onSettled: (_data, _error, conversationId) => {
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      void queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
    },
  });
}
