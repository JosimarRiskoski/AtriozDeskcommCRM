"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import type { Note } from "@/lib/types/messaging";

const NOTES_LOAD_ERROR_TITLE = "Não foi possível carregar as notas internas.";

export function describeConversationNotesLoadError(error: unknown) {
  if (error instanceof ApiError) {
    return {
      title: NOTES_LOAD_ERROR_TITLE,
      description: `${error.message}${error.requestId ? ` · ID: ${error.requestId}` : ""}`,
    };
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      title: NOTES_LOAD_ERROR_TITLE,
      description: "A solicitação demorou mais de 10 segundos para responder.",
    };
  }

  if (error instanceof TypeError) {
    return {
      title: NOTES_LOAD_ERROR_TITLE,
      description: "Não foi possível conectar ao CRM. Verifique a conexão e tente novamente.",
    };
  }

  return {
    title: NOTES_LOAD_ERROR_TITLE,
    description: "Falha de comunicação com o CRM. Tente novamente.",
  };
}

/** Onda 5.2: notas internas da conversa (poucas por conversa — query simples, sem paginação). */
export function useConversationNotes(conversationId: string | null) {
  const qc = useQueryClient();
  const reportedErrorRef = useRef<unknown>(null);
  const queryKey = ["notes", conversationId] as const;

  const query = useQuery({
    queryKey,
    enabled: !!conversationId,
    queryFn: () => apiClient.get<{ data: Note[] }>(`/api/v1/conversations/${conversationId}/notes`),
    select: (res) => res.data,
  });

  useEffect(() => {
    if (!query.isError) {
      reportedErrorRef.current = null;
      return;
    }

    if (reportedErrorRef.current === query.error) return;
    reportedErrorRef.current = query.error;

    const { title, description } = describeConversationNotesLoadError(query.error);
    toast.error(title, { description });
  }, [query.error, query.isError]);

  const onChange = useCallback(() => {
    if (conversationId) qc.invalidateQueries({ queryKey: ["notes", conversationId] });
  }, [qc, conversationId]);

  useRealtimeChannel({
    name: conversationId ? `conversation-notes-${conversationId}` : "conversation-notes-disabled",
    postgresChanges: conversationId
      ? {
          event: "*",
          schema: "public",
          table: "conversation_notes",
          filter: `conversation_id=eq.${conversationId}`,
        }
      : undefined,
    onChange,
    enabled: !!conversationId,
  });

  return query.data ?? [];
}
