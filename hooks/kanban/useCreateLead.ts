"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Lead } from "@/lib/types/leads";
import type { CreateLeadInput } from "@/lib/schemas/leads";
import { ApiError } from "@/lib/api/types";

export function useCreateLead(pipelineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateLeadInput) =>
      apiClient.post<{ data: Lead }>("/api/v1/leads", input),
    onError: (error) => {
      // O diálogo transforma este conflito numa saída útil para a oportunidade
      // existente. Não exiba também o aviso genérico vermelho.
      if (error instanceof ApiError && error.code === "open_opportunity_exists") return;
      showApiError(error);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["board", pipelineId] }),
  });
}
