import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export type OperationalHealth = "ok" | "warning" | "critical";

export interface OperationalHealthItem {
  id: "database" | "whatsapp" | "automation" | "ai" | "email" | "webhooks";
  label: string;
  status: OperationalHealth;
  summary: string;
  detail: string;
  action_label?: string;
  action_url?: string;
}

export interface OperationalHealthPayload {
  status: OperationalHealth;
  checked_at: string;
  items: OperationalHealthItem[];
}

function overall(items: OperationalHealthItem[]): OperationalHealth {
  if (items.some((item) => item.status === "critical")) return "critical";
  if (items.some((item) => item.status === "warning")) return "warning";
  return "ok";
}

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "system_health" });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  const orgId = authz.org.orgId;
  const workerActions = [
    "campaign.worker_run",
    "followup.worker_run",
    "routing.worker_run",
    "rag.conversations_batch_run",
    "conversation.snooze_watcher_run",
  ];

  const [database, sessions, credentials, workerRun, webhookFailure, webhookSources] =
    await Promise.all([
      admin.from("organizations").select("id").eq("id", orgId).maybeSingle(),
      admin
        .from("channel_sessions")
        .select("id, status, last_health_check_at, status_reason")
        .eq("organization_id", orgId)
        .is("archived_at", null),
      admin
        .from("ai_provider_credentials")
        .select("id, provider, is_active, validated_at, validation_error")
        .eq("organization_id", orgId)
        .eq("is_active", true),
      admin
        .from("api_audit_log")
        .select("action, created_at")
        .eq("organization_id", orgId)
        .in("action", workerActions)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("webhook_events_log")
        .select("id, received_at, error_message")
        .eq("organization_id", orgId)
        .eq("status", "failed")
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("webhook_sources")
        .select("id, is_active, last_received_at")
        .eq("organization_id", orgId)
        .eq("is_active", true),
    ]);

  if (database.error) {
    return fail("internal_error", "Não foi possível consultar a saúde da organização.", 500, {
      requestId,
    });
  }

  const now = Date.now();
  const connected = (sessions.data ?? []).filter((session) => session.status === "WORKING");
  const failedSessions = (sessions.data ?? []).filter((session) =>
    ["FAILED", "STOPPED"].includes(session.status),
  );
  const validCredentials = (credentials.data ?? []).filter(
    (credential) => credential.validated_at && !credential.validation_error,
  );
  const lastWorkerAt = workerRun.data?.created_at ?? null;
  const workerAgeMinutes = lastWorkerAt
    ? Math.round((now - new Date(lastWorkerAt).getTime()) / 60_000)
    : null;
  const resendConfigured = Boolean(
    process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL,
  );
  const activeWebhookSources = webhookSources.data?.length ?? 0;
  const recentWebhookFailure = webhookFailure.data;
  const failureAgeHours = recentWebhookFailure
    ? (now - new Date(recentWebhookFailure.received_at).getTime()) / 3_600_000
    : null;

  const items: OperationalHealthItem[] = [
    {
      id: "database",
      label: "Banco e organização",
      status: "ok",
      summary: "Banco acessível e organização isolada",
      detail: "A consulta autenticada da organização foi concluída.",
    },
    {
      id: "whatsapp",
      label: "WhatsApp",
      status: failedSessions.length > 0 ? "critical" : connected.length > 0 ? "ok" : "warning",
      summary:
        failedSessions.length > 0
          ? `${failedSessions.length} conexão(ões) com falha`
          : connected.length > 0
            ? `${connected.length} conexão(ões) operacional(is)`
            : "Nenhum número operacional",
      detail:
        failedSessions[0]?.status_reason ||
        (connected.length > 0
          ? "Inbox, atendimento humano e IA podem usar os números conectados."
          : "Conecte ou reconecte um número antes de atender."),
      action_label: "Abrir conexões",
      action_url: "/app/connections",
    },
    {
      id: "automation",
      label: "Workers e agendamentos",
      status:
        !process.env.INTERNAL_CRON_SECRET || workerAgeMinutes === null || workerAgeMinutes > 60
          ? "warning"
          : "ok",
      summary:
        workerAgeMinutes === null
          ? "Nenhuma execução recente registrada"
          : `Última execução automática há ${workerAgeMinutes} min`,
      detail: !process.env.INTERNAL_CRON_SECRET
        ? "O segredo interno dos agendamentos não está configurado."
        : workerAgeMinutes !== null && workerAgeMinutes <= 60
          ? "O sistema registrou atividade recente de um worker."
          : "Confira scheduler e worker no EasyPanel antes de ativar automações.",
      action_label: "Ver follow-ups",
      action_url: "/app/ai/followups",
    },
    {
      id: "ai",
      label: "Inteligência artificial",
      status: validCredentials.length > 0 ? "ok" : "warning",
      summary:
        validCredentials.length > 0
          ? `${validCredentials.length} credencial(is) validada(s)`
          : "Nenhuma credencial validada",
      detail:
        validCredentials.length > 0
          ? "Existe provedor disponível; limites e saldo ainda devem ser acompanhados."
          : "Cadastre e valide uma credencial antes de publicar o agente.",
      action_label: "Abrir credenciais",
      action_url: "/app/ai/credentials",
    },
    {
      id: "email",
      label: "E-mail",
      status: resendConfigured ? "ok" : "warning",
      summary: resendConfigured ? "Resend configurado" : "Envio real não configurado",
      detail: resendConfigured
        ? "Convites e notificações por e-mail possuem configuração de envio."
        : "Configure RESEND_API_KEY e RESEND_FROM_EMAIL no servidor.",
      action_label: "Abrir notificações",
      action_url: "/app/settings/notifications",
    },
    {
      id: "webhooks",
      label: "Webhooks e integrações",
      status:
        recentWebhookFailure && failureAgeHours !== null && failureAgeHours <= 24
          ? "critical"
          : activeWebhookSources > 0
            ? "ok"
            : "warning",
      summary:
        recentWebhookFailure && failureAgeHours !== null && failureAgeHours <= 24
          ? "Falha de webhook nas últimas 24 horas"
          : `${activeWebhookSources} origem(ns) ativa(s)`,
      detail:
        recentWebhookFailure && failureAgeHours !== null && failureAgeHours <= 24
          ? recentWebhookFailure.error_message || "Abra os eventos para diagnosticar a falha."
          : activeWebhookSources > 0
            ? "As origens configuradas estão ativas."
            : "Nenhuma origem externa está ativa; isso é normal se você não usa integrações.",
      action_label: "Abrir webhooks",
      action_url: "/app/webhooks",
    },
  ];

  const payload: OperationalHealthPayload = {
    status: overall(items),
    checked_at: new Date().toISOString(),
    items,
  };
  return ok(payload, { requestId });
}
