"use client";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";
import { realtimeFallbackIntervalMs } from "@/hooks/realtime/fallback-policy";
import { apiClient } from "@/lib/api/client";
import type { Message } from "@/lib/types/messaging";

interface MessagesResponse {
  data: Message[];
  meta?: { cursor?: string | null; has_more?: boolean };
}

export function useMessagesRealtime(conversationId: string | null) {
  const qc = useQueryClient();
  const queryKey = ["messages", conversationId] as const;

  const onChange = useCallback(() => {
    if (conversationId) qc.invalidateQueries({ queryKey: ["messages", conversationId] });
    qc.invalidateQueries({ queryKey: ["conversations"] });
  }, [qc, conversationId]);

  const realtime = useRealtimeChannel({
    name: conversationId ? `messages-${conversationId}` : "messages-disabled",
    postgresChanges: conversationId
      ? {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
          // O callback apenas invalida a query. Nao envie media_url/base64 nem
          // metadata pelo WebSocket para cada alteracao de status da mensagem.
          select: ["id", "conversation_id"],
        }
      : undefined,
    onChange,
    enabled: !!conversationId,
  });

  const query = useInfiniteQuery({
    queryKey,
    enabled: !!conversationId,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      if (!conversationId) {
        return { data: [], meta: { has_more: false, cursor: null } } as MessagesResponse;
      }
      const qs = new URLSearchParams();
      if (pageParam) qs.set("cursor", pageParam);
      qs.set("limit", "50");
      // Esta query tambem roda por recuperacao de Realtime, foco e reconexao.
      // Um erro automatico deve manter o estado de erro acionavel da tela, mas
      // nao disparar um toast a cada tentativa/retry (o que escondia o Inbox).
      return apiClient.get<MessagesResponse>(
        `/api/v1/conversations/${conversationId}/messages?${qs.toString()}`,
      );
    },
    getNextPageParam: (last) =>
      last.meta?.has_more && last.meta.cursor ? last.meta.cursor : undefined,
    // Realtime entrega a mensagem imediatamente. A leitura periódica só cura
    // perda silenciosa: 60s saudável, 10s quando o canal reporta degradação.
    refetchInterval: () => realtimeFallbackIntervalMs(realtime.status),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });

  return query;
}
