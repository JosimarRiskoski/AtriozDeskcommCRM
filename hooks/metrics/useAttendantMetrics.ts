"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";

export interface FunnelStage {
  stage_id: string;
  stage_name: string;
  position: number;
  count: number;
}

export interface AttendantMetric {
  user_id: string;
  won: number;
  lost: number;
  conversations_handled: number;
  avg_first_response_seconds: number | null;
  name: string | null;
  email: string | null;
}

export interface AttendantMetrics {
  window: { from: string; to: string };
  owner_user_id: string | null;
  funnel: FunnelStage[];
  attendants: AttendantMetric[];
  messages: {
    received: number;
    outbound_recorded: number;
    outbound_delivered: number;
    outbound_read: number;
    outbound_failed: number;
  };
}

/** spec 13 §6 — funil + performance por atendente. `owner` filtra (manager+). */
export function useAttendantMetrics(owner: string | null, days = 30) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  if (owner) params.set("owner_user_id", owner);
  const qs = `?${params.toString()}`;
  return useQuery({
    queryKey: ["metrics", "attendants", owner ?? "all", days],
    queryFn: async () =>
      apiClient.get<{ data: AttendantMetrics }>(`/api/v1/metrics/attendants${qs}`),
    staleTime: 30_000,
  });
}
