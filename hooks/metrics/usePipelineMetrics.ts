"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";

export interface PipelineManagementMetrics {
  stages: Array<{
    stage_id: string;
    stage_name: string;
    position: number;
    open_count: number;
    value_cents: number;
    entries: number;
    avg_seconds: number | null;
  }>;
  outcomes: {
    won: number;
    lost: number;
    won_value_cents: number;
    lost_value_cents: number;
  };
  owners: Array<{
    owner_kind: "user" | "ai" | null;
    owner_user_id: string | null;
    owner_agent_id: string | null;
    open_count: number;
    value_cents: number;
  }>;
}

export function usePipelineMetrics(days: number, enabled: boolean) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  return useQuery({
    queryKey: ["metrics", "pipeline-management", days],
    enabled,
    queryFn: async () =>
      (
        await apiClient.get<{ data: PipelineManagementMetrics }>(
          `/api/v1/metrics/pipeline?${query}`,
        )
      ).data,
    staleTime: 30_000,
  });
}
