"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

export function useDeleteContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["contacts", "delete"],
    mutationFn: async (contactId: string) => {
      await apiClient.delete(`/api/v1/contacts/${contactId}`);
      return contactId;
    },
    onSuccess: (contactId) => {
      queryClient.removeQueries({ queryKey: ["contact", contactId] });
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("Contato excluÃ­do.");
    },
    onError: showApiError,
  });
}
