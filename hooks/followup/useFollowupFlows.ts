"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { FollowupPresetId } from "@/lib/followup/presets";

export type FollowupFlowStatus = "draft" | "active" | "disabled";

export interface FollowupFlowPointerRow {
  id: string;
  name: string;
  status: FollowupFlowStatus;
  active_version_id: string | null;
  handoff_policy: string;
  trigger_config?: Record<string, unknown>;
  objective?: string;
  duration_minutes?: number;
  steps_count?: number;
  next_send_minutes?: number;
  agent_name?: string | null;
  channel_name?: string | null;
  cancel_on_reply?: boolean;
  updated_at: string;
}

interface ListResponse {
  data: FollowupFlowPointerRow[];
}

interface SingleResponse {
  data: FollowupFlowPointerRow;
}

export const followupFlowsListQueryKey = ["followup", "flows", "list"] as const;

export function useFollowupFlows(opts?: { initialData?: FollowupFlowPointerRow[] }) {
  return useQuery({
    queryKey: followupFlowsListQueryKey,
    queryFn: async () => {
      try {
        const res = await apiClient.get<ListResponse>("/api/v1/ai/followup-flows");
        return res.data;
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
    initialData: opts?.initialData,
  });
}

export function useCreateFollowupFlow() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["followup", "flows", "create"],
    mutationFn: async ({ name, presetId }: { name: string; presetId: FollowupPresetId }) => {
      const res = await apiClient.post<SingleResponse>("/api/v1/ai/followup-flows", {
        name,
        preset_id: presetId,
      });
      return res.data;
    },
    onSuccess: (created) => {
      qc.setQueryData<FollowupFlowPointerRow[]>(followupFlowsListQueryKey, (prev) =>
        prev ? [created, ...prev] : [created],
      );
      toast.success("Fluxo criado.");
    },
    onError: (err) => {
      showApiError(err);
    },
  });
}

export function useDeleteFollowupFlow() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["followup", "flows", "delete"],
    mutationFn: async (id: string) => {
      await apiClient.delete(`/api/v1/ai/followup-flows/${id}`);
      return id;
    },
    onSuccess: (id) => {
      qc.setQueryData<FollowupFlowPointerRow[]>(followupFlowsListQueryKey, (prev) =>
        prev?.filter((flow) => flow.id !== id),
      );
      toast.success("Fluxo excluÃ­do.");
    },
    onError: (err) => {
      showApiError(err);
    },
  });
}
