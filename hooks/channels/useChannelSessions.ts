"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

export interface ChannelSession {
  id: string;
  provider: "evolution";
  external_session_name: string;
  display_name: string | null;
  display_color: string;
  phone_number: string | null;
  purpose: string | null;
  is_default: boolean;
  archived_at: string | null;
  status: string;
  status_reason: string | null;
  last_health_check_at: string | null;
  last_inbound_event_at: string | null;
  last_outbound_event_at: string | null;
  last_status_change_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  daily_message_limit: number;
  is_warmup_complete: boolean | null;
  created_at: string;
}

export type ConnectionHealth = "connected" | "connecting" | "down" | "none";

/**
 * Lista os canais WhatsApp (channel_sessions) da org ativa. Fonte única
 * para o seletor do inbox, o sinal de saúde da sidebar e a Central de Conexões.
 */
export function useChannelSessions(opts?: {
  refetchInterval?: number;
  enabled?: boolean;
  includeArchived?: boolean;
}) {
  return useQuery({
    queryKey: ["channel-sessions", { includeArchived: opts?.includeArchived ?? false }],
    queryFn: async () => {
      const suffix = opts?.includeArchived ? "?include_archived=1" : "";
      const res = await apiClient.get<{ data: ChannelSession[] }>(
        `/api/v1/channel-sessions${suffix}`,
      );
      return res.data;
    },
    staleTime: 15_000,
    refetchInterval: opts?.refetchInterval,
    enabled: opts?.enabled ?? true,
  });
}

/**
 * Saúde agregada: vermelho vence (um número caído é o que o usuário precisa
 * ver na hora), depois amarelo (conectando), senão verde (tudo WORKING).
 */
export function deriveOverallHealth(sessions: ChannelSession[] | undefined): ConnectionHealth {
  if (!sessions || sessions.length === 0) return "none";
  if (sessions.some((s) => s.status === "FAILED" || s.status === "STOPPED")) return "down";
  if (sessions.some((s) => s.status === "STARTING" || s.status === "SCAN_QR_CODE"))
    return "connecting";
  return "connected";
}
