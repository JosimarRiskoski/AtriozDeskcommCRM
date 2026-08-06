"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import { toast } from "sonner";

export interface AiAutomationSettings {
  enabled_for_all: boolean;
}

const queryKey = ["settings", "ai-automation"] as const;

export function useAiAutomation() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await apiClient.get<{ data: AiAutomationSettings }>(
        "/api/v1/settings/ai-automation",
      );
      return response.data;
    },
    staleTime: 30_000,
  });
  const update = useMutation({
    mutationFn: async (enabled_for_all: boolean) => {
      const response = await apiClient.patch<{ data: AiAutomationSettings }>(
        "/api/v1/settings/ai-automation",
        { enabled_for_all },
      );
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      toast.success(
        data.enabled_for_all
          ? "IA automática ligada para todas as conversas elegíveis."
          : "IA geral desligada. Somente contatos ativados manualmente serão atendidos.",
      );
    },
    onError: showApiError,
  });

  return { ...query, update };
}
