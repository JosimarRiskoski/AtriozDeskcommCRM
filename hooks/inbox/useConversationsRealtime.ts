"use client";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";
import { realtimeFallbackIntervalMs } from "@/hooks/realtime/fallback-policy";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Conversation } from "@/lib/types/messaging";

export interface ContactSummary {
  id: string;
  display_name: string | null;
  name: string | null;
  phone_number: string | null;
  tags: string[];
  is_blocked: boolean;
  blocked_reason: string | null;
  blocked_at: string | null;
  is_anonymized: boolean;
  consent?: Record<string, unknown>;
  source?: string;
  source_metadata?: Record<string, unknown>;
}

export type ConversationWithContact = Conversation & {
  contacts?: ContactSummary | null;
  channel_sessions?: {
    id: string;
    display_name: string | null;
    display_color: string;
    phone_number: string | null;
    external_session_name: string | null;
    archived_at: string | null;
    status: string;
  } | null;
};

export interface ConversationsFilters {
  status?: "open" | "claimed" | "ai_handling" | "closed" | "archived";
  assigned_to?: "me" | "unassigned" | string;
  search?: string;
  channel_session_id?: string;
  include_archived_connections?: boolean;
  tag?: string;
}

interface ListResponse {
  data: ConversationWithContact[];
  meta?: { cursor?: string | null; has_more?: boolean };
}

export function useConversationsRealtime(filters: ConversationsFilters, orgId: string | null) {
  const qc = useQueryClient();
  const queryKey = ["conversations", filters] as const;

  const onChange = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["conversations"] });
  }, [qc]);

  const realtime = useRealtimeChannel({
    name: orgId ? `inbox-${orgId}` : "inbox-disabled",
    postgresChanges: orgId
      ? {
          event: "*",
          schema: "public",
          table: "conversations",
          filter: `organization_id=eq.${orgId}`,
          // O callback apenas invalida a lista; os detalhes chegam pela API.
          select: ["id", "organization_id"],
        }
      : undefined,
    onChange,
    enabled: !!orgId,
  });

  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams();
      if (filters.status) qs.set("status", filters.status);
      if (filters.assigned_to) qs.set("assigned_to", filters.assigned_to);
      if (filters.search) qs.set("search", filters.search);
      if (filters.channel_session_id) qs.set("channel_session_id", filters.channel_session_id);
      if (filters.include_archived_connections) qs.set("include_archived_connections", "1");
      if (filters.tag) qs.set("tag", filters.tag);
      if (pageParam) qs.set("cursor", pageParam);
      qs.set("limit", "50");
      try {
        return await apiClient.get<ListResponse>(`/api/v1/conversations?${qs.toString()}`);
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
    getNextPageParam: (last) =>
      last.meta?.has_more && last.meta.cursor ? last.meta.cursor : undefined,
    // O Realtime é o caminho principal. A conferência periódica é apenas uma
    // rede de segurança: 60s quando saudável e 10s durante degradação. O valor
    // anterior (2s) fazia 43.200 leituras/dia por aba apenas nesta consulta.
    refetchInterval: () => realtimeFallbackIntervalMs(realtime.status),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });

  // G4-01 (visibility_mode): a subscription postgres_changes HERDA a RLS de
  // SELECT de `conversations` — o Supabase Realtime avalia as policies do usuário
  // autenticado antes de entregar cada change (docs: "Realtime respects RLS
  // policies"; requer a tabela na publication `supabase_realtime` + REPLICA
  // IDENTITY, já configurados na migration 0025). Como a policy `conversations_select`
  // (migration 0035) agora aplica fn_can_view_conversation(role + visibility_mode +
  // assigned_to), um agent NÃO recebe changes de conversa fora do seu escopo, mesmo
  // com o filtro amplo `organization_id=eq.<org>` abaixo. Prova do filtro em
  // tests/invariants/gov-5-visibility-scope.test.ts (SELECT sob role agent = 0 rows
  // para conversa de outro atendente — o mesmo SELECT que o Realtime executa).
  return query;
}
