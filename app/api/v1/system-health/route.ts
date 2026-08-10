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

  const [
    database,
    sessions,
    credentials,
    workerRun,
    webhookFailure,
    webhookSources,
    aiJobs,
    llmFailure,
    pendingDispatches,
  ] = await Promise.all([
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
    admin
      .from("job_queue")
      .select("id, status, last_error, created_at, run_after")
      .eq("organization_id", orgId)
      .in("kind", ["inbound_turn", "case_reply_turn"])
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("llm_calls")
      .select("id, error_code, error_message, http_status, created_at")
      .eq("organization_id", orgId)
      .eq("status", "erro")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("event_log")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("event_type", "ai_agent.dispatch_requested")
      .eq("status", "pending"),
  ]);

  if (database.error) {
    return fail("internal_error", "Não foi possível consultar a saúde da organização.", 500, {
      requestId,
    });
  }

  const now = Date.now();
  const recentAiJobs = aiJobs.data ?? [];
  const failureWindowStart = now - 24 * 60 * 60_000;
  const failedAiJobs = recentAiJobs.filter(
    (job) =>
      ["failed", "dead"].includes(job.status) &&
      new Date(job.created_at).getTime() >= failureWindowStart,
  );
  const stalledAiJobs = recentAiJobs.filter(
    (job) =>
      job.status === "pending" &&
      now - new Date(job.run_after ?? job.created_at).getTime() > 5 * 60_000,
  );
  const latestCompletedAiJob = recentAiJobs.find((job) => job.status === "done") ?? null;
  const recentLlmFailure = llmFailure.data;
  const llmFailureAgeMinutes = recentLlmFailure
    ? Math.round((now - new Date(recentLlmFailure.created_at).getTime()) / 60_000)
    : null;
  const aiHasCriticalFailure =
    failedAiJobs.length > 0 ||
    stalledAiJobs.length > 0 ||
    (llmFailureAgeMinutes !== null && llmFailureAgeMinutes <= 60);
  const pendingAiDispatches = pendingDispatches.count ?? 0;
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
  const resendConfigured = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
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
      label: "Motor de IA e agendamentos",
      status: aiHasCriticalFailure
        ? "critical"
        : !process.env.INTERNAL_CRON_SECRET ||
            workerAgeMinutes === null ||
            workerAgeMinutes > 60 ||
            pendingAiDispatches > 0
          ? "warning"
          : "ok",
      summary:
        failedAiJobs.length > 0
          ? `${failedAiJobs.length} execução(ões) de IA falharam`
          : stalledAiJobs.length > 0
            ? `${stalledAiJobs.length} mensagem(ns) aguardando IA há mais de 5 min`
            : pendingAiDispatches > 0
              ? `${pendingAiDispatches} evento(s) de IA aguardando processamento`
              : workerAgeMinutes === null
                ? "Nenhuma execução recente registrada"
                : `Última execução automática há ${workerAgeMinutes} min`,
      detail: failedAiJobs[0]?.last_error
        ? `Falha mais recente: ${failedAiJobs[0].last_error}`
        : latestCompletedAiJob
          ? `O motor concluiu uma execução em ${new Date(latestCompletedAiJob.created_at).toLocaleString("pt-BR")}.`
          : !process.env.INTERNAL_CRON_SECRET
            ? "O segredo interno dos agendamentos não está configurado."
            : "Confira o serviço worker no EasyPanel antes de ativar automações.",
      action_label: "Ver execuções de IA",
      action_url: "/app/ai/runs",
    },
    {
      id: "ai",
      label: "Inteligência artificial",
      status: aiHasCriticalFailure ? "critical" : validCredentials.length > 0 ? "ok" : "warning",
      summary:
        recentLlmFailure && llmFailureAgeMinutes !== null && llmFailureAgeMinutes <= 60
          ? `Falha recente: ${recentLlmFailure.error_code ?? "erro do provedor"}`
          : validCredentials.length > 0
            ? `${validCredentials.length} credencial(is) validada(s)`
            : "Nenhuma credencial validada",
      detail:
        recentLlmFailure && llmFailureAgeMinutes !== null && llmFailureAgeMinutes <= 60
          ? recentLlmFailure.error_message || "A chamada ao provedor de IA falhou."
          : validCredentials.length > 0
            ? "A credencial está validada e o painel também verifica a execução real do motor."
            : "Cadastre e valide uma credencial antes de publicar o agente.",
      action_label: aiHasCriticalFailure ? "Ver execuções" : "Abrir credenciais",
      action_url: aiHasCriticalFailure ? "/app/ai/runs" : "/app/ai/credentials",
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
