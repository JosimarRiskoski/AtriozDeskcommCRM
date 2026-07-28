"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";

interface EnrollmentResponse {
  data: {
    id: string;
    pointer_id: string;
    contact_id: string;
    status: string;
  };
}

export function useStartFollowupEnrollment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["followup", "enrollments", "create"],
    mutationFn: async ({ pointerId, contactId }: { pointerId: string; contactId: string }) => {
      const response = await apiClient.post<EnrollmentResponse>(
        "/api/v1/ai/followups/enrollments",
        { pointer_id: pointerId, contact_id: contactId },
      );
      return response.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["followup", "queue"] });
      toast.success("Follow-up iniciado para este contato.", {
        description: "Ele já aparece na fila e seguirá os horários do fluxo publicado.",
      });
    },
    onError: (error) => showApiError(error),
  });
}
