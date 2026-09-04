import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { getEvolutionClient } from "@/lib/evolution/client";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type WebhookStatus = "received" | "processed" | "error" | string;

export interface WhatsAppDiagnosticsPayload {
  checked_at: string;
  sessions: Array<{
    id: string;
    label: string;
    status: string | null;
    last_health_check_at: string | null;
    status_reason: string | null;
  }>;
  latest_webhook: {
    received_at: string | null;
    event_type: string | null;
    status: WebhookStatus | null;
    error_message: string | null;
  } | null;
  latest_inbound: { received_at: string | null; conversation_id: string | null } | null;
  pending_identity: { total: number; failed: number; oldest_at: string | null };
  remote_webhook: {
    status: "configured" | "mismatch" | "unavailable";
    detail: string;
  } | null;
}

/**
 * Painel administrativo, sem payloads e sem telefone: mostra em qual fronteira
 * um inbound parou (Evolution -> webhook -> mensagem -> conversa). Assim uma
 * falha de entrega deixa de parecer um simples "Inbox vazio".
 */
export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "whatsapp_diagnostics" });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  const orgId = authz.org.orgId;
  const [sessionsResult, webhooksResult, inboundResult, pendingResult] = await Promise.all([
    admin
      .from("channel_sessions")
      .select(
        "id, display_name, external_session_name, webhook_path_token, status, last_health_check_at, status_reason",
      )
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    admin
      .from("webhook_events_log")
      .select("received_at, event_type, status, error_message")
      .eq("organization_id", orgId)
      .eq("provider", "evolution")
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("messages")
      .select("sent_at, conversation_id")
      .eq("organization_id", orgId)
      .eq("direction", "inbound")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("whatsapp_inbound_pending")
      .select("status, created_at")
      .eq("organization_id", orgId)
      .in("status", ["pending", "failed", "exhausted"])
      .order("created_at", { ascending: true })
      .limit(100),
  ]);

  const errors = [
    sessionsResult.error,
    webhooksResult.error,
    inboundResult.error,
    pendingResult.error,
  ].filter(Boolean);
  if (errors.length > 0) {
    return fail("internal_error", "Não foi possível montar o diagnóstico do WhatsApp.", 500, {
      requestId,
    });
  }

  const pending = pendingResult.data ?? [];
  const sessionForRemoteCheck = (sessionsResult.data ?? []).find(
    (session) => session.external_session_name && session.webhook_path_token,
  );
  let remoteWebhook: WhatsAppDiagnosticsPayload["remote_webhook"] = null;

  if (sessionForRemoteCheck?.external_session_name && sessionForRemoteCheck.webhook_path_token) {
    const evolution = getEvolutionClient();
    if (!evolution) {
      remoteWebhook = {
        status: "unavailable",
        detail: "A leitura da configuração da Evolution não está disponível neste ambiente.",
      };
    } else {
      try {
        const configured = await evolution.getWebhook(sessionForRemoteCheck.external_session_name);
        const expectedUrl = `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/v1/webhooks/evolution/${sessionForRemoteCheck.webhook_path_token}`;
        const hasInboundEvent = configured.events.includes("MESSAGES_UPSERT");
        const isCorrect =
          configured.enabled &&
          configured.url === expectedUrl &&
          hasInboundEvent &&
          configured.hasHeaders &&
          !configured.byEvents;
        remoteWebhook = isCorrect
          ? {
              status: "configured",
              detail: "A Evolution está configurada para enviar novas mensagens ao CRM.",
            }
          : {
              status: "mismatch",
              detail:
                "A configuração gravada na Evolution não está pronta para entregar novas mensagens ao CRM.",
            };
      } catch {
        remoteWebhook = {
          status: "unavailable",
          detail: "Não foi possível consultar a configuração gravada na Evolution agora.",
        };
      }
    }
  }

  return ok(
    {
      checked_at: new Date().toISOString(),
      sessions: (sessionsResult.data ?? []).map((session) => ({
        id: session.id,
        label: session.display_name || session.external_session_name || "Conexão sem nome",
        status: session.status,
        last_health_check_at: session.last_health_check_at,
        status_reason: session.status_reason,
      })),
      latest_webhook: webhooksResult.data
        ? {
            received_at: webhooksResult.data.received_at,
            event_type: webhooksResult.data.event_type,
            status: webhooksResult.data.status,
            error_message: webhooksResult.data.error_message,
          }
        : null,
      latest_inbound: inboundResult.data
        ? {
            received_at: inboundResult.data.sent_at,
            conversation_id: inboundResult.data.conversation_id,
          }
        : null,
      pending_identity: {
        total: pending.length,
        failed: pending.filter((item) => item.status !== "pending").length,
        oldest_at: pending[0]?.created_at ?? null,
      },
      remote_webhook: remoteWebhook,
    } satisfies WhatsAppDiagnosticsPayload,
    { requestId },
  );
}
