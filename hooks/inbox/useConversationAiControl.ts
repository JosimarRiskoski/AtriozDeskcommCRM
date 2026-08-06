"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { toast } from "sonner";

export function useConversationAiControl(conversationId: string) {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
    queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
  };

  const pause = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/conversations/${conversationId}/pause-bot`, {}),
    onSuccess: refresh,
    onError: (error) => {
      refresh();
      showApiError(error);
    },
  });

  const reactivate = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/conversations/${conversationId}/reactivate-bot`, {}),
    onSuccess: refresh,
    onError: (error) => {
      refresh();
      showApiError(error);
    },
  });

  const setMode = useMutation({
    mutationFn: (mode: "inherit" | "force_active" | "force_paused") =>
      apiClient.post(`/api/v1/conversations/${conversationId}/ai-control`, { mode }),
    onSuccess: (_data, mode) => {
      refresh();
      toast.success(
        mode === "force_active"
          ? "Conversa devolvida para a IA."
          : mode === "force_paused"
            ? "IA pausada neste contato."
            : "Conversa voltou para a regra geral da IA.",
      );
    },
    onError: (error) => {
      refresh();
      showApiError(error);
    },
  });

  return { pause, reactivate, setMode };
}
