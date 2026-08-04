import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  classifyFailure,
  failureRecommendation,
  understandableFailure,
  type FailureCategory,
} from "@/lib/metrics/failure-presentation";
import { createAdminClient } from "@/lib/supabase/admin";

const querySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  category: z.string().optional(),
  module: z.string().optional(),
});

type RawFailure = {
  id: string;
  occurred_at: string;
  contact_id: string | null;
  channel_session_id: string | null;
  operation: string;
  module: string;
  code: string | null;
  message: string | null;
  attempts: number;
  final_status: string;
  technical: Record<string, unknown>;
};

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "metrics_failures" });
  if (!authz.ok) return authz.response;
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!parsed.success) return fail("validation_failed", "Filtros inválidos.", 422, { requestId });
  const to = parsed.data.to ?? new Date().toISOString();
  const from = parsed.data.from ?? new Date(Date.now() - 30 * 86400_000).toISOString();
  const admin = createAdminClient() as unknown as SupabaseClient;
  const orgId = authz.org.orgId;
  const [messages, campaigns, agents, automations, webhooks] = await Promise.all([
    admin
      .from("messages")
      .select(
        "id,created_at,contact_id,channel_session_id,type,sent_via,status,error_code,error_message,metadata",
      )
      .eq("organization_id", orgId)
      .eq("direction", "outbound")
      .eq("status", "failed")
      .gte("created_at", from)
      .lte("created_at", to)
      .order("created_at", { ascending: false })
      .limit(250),
    admin
      .from("outreach_campaign_recipients")
      .select(
        "id,updated_at,contact_id,channel_session_id,attempts,status,last_error_code,last_error_message,campaign_id",
      )
      .eq("organization_id", orgId)
      .eq("status", "failed")
      .gte("updated_at", from)
      .lte("updated_at", to)
      .order("updated_at", { ascending: false })
      .limit(250),
    admin
      .from("ai_agent_runs")
      .select(
        "id,created_at,contact_id,channel_session_id,status,error_code,error_message,abort_reason,steps_count,latency_ms,agent_id",
      )
      .eq("organization_id", orgId)
      .eq("status", "failed")
      .gte("created_at", from)
      .lte("created_at", to)
      .order("created_at", { ascending: false })
      .limit(250),
    admin
      .from("automation_rule_runs")
      .select("id,created_at,status,error,rule_id,actions_result")
      .eq("organization_id", orgId)
      .in("status", ["failed", "partial"])
      .gte("created_at", from)
      .lte("created_at", to)
      .order("created_at", { ascending: false })
      .limit(250),
    admin
      .from("webhook_events_log")
      .select("id,received_at,channel_session_id,status,error_message,event_type,provider,attempts")
      .eq("organization_id", orgId)
      .in("status", ["failed", "error", "dead"])
      .gte("received_at", from)
      .lte("received_at", to)
      .order("received_at", { ascending: false })
      .limit(250),
  ]);
  const queryError = [messages, campaigns, agents, automations, webhooks].find(
    (result) => result.error,
  )?.error;
  if (queryError)
    return fail("internal_error", "Não foi possível carregar as falhas.", 500, { requestId });

  const raw: RawFailure[] = [
    ...(messages.data ?? []).map((row) => ({
      id: `message:${row.id}`,
      occurred_at: row.created_at,
      contact_id: row.contact_id,
      channel_session_id: row.channel_session_id,
      operation: "Envio de mensagem",
      module: (row.metadata as Record<string, unknown> | null)?.campaign_id ? "Campanhas" : "Inbox",
      code: row.error_code,
      message: row.error_message,
      attempts: Number((row.metadata as Record<string, unknown> | null)?.attempts ?? 1),
      final_status: row.status,
      technical: {
        message_id: row.id,
        type: row.type,
        sent_via: row.sent_via,
        error_code: row.error_code,
      },
    })),
    ...(campaigns.data ?? []).map((row) => ({
      id: `campaign:${row.id}`,
      occurred_at: row.updated_at,
      contact_id: row.contact_id,
      channel_session_id: row.channel_session_id,
      operation: "Envio de campanha",
      module: "Campanhas",
      code: row.last_error_code,
      message: row.last_error_message,
      attempts: row.attempts,
      final_status: row.status,
      technical: {
        recipient_id: row.id,
        campaign_id: row.campaign_id,
        error_code: row.last_error_code,
      },
    })),
    ...(agents.data ?? []).map((row) => ({
      id: `ai:${row.id}`,
      occurred_at: row.created_at,
      contact_id: row.contact_id,
      channel_session_id: row.channel_session_id,
      operation: "Resposta da IA",
      module: "IA",
      code: row.error_code ?? row.abort_reason,
      message: row.error_message,
      attempts: Math.max(1, row.steps_count),
      final_status: row.status,
      technical: {
        run_id: row.id,
        agent_id: row.agent_id,
        latency_ms: row.latency_ms,
        abort_reason: row.abort_reason,
      },
    })),
    ...(automations.data ?? []).map((row) => ({
      id: `automation:${row.id}`,
      occurred_at: row.created_at,
      contact_id: null,
      channel_session_id: null,
      operation: "Execução de automação",
      module: "Automações",
      code: "automation_failed",
      message: row.error,
      attempts: 1,
      final_status: row.status,
      technical: { run_id: row.id, rule_id: row.rule_id, actions_result: row.actions_result },
    })),
    ...(webhooks.data ?? []).map((row) => ({
      id: `webhook:${row.id}`,
      occurred_at: row.received_at,
      contact_id: null,
      channel_session_id: row.channel_session_id,
      operation: "Recebimento de integração",
      module: "Integrações",
      code: row.event_type,
      message: row.error_message,
      attempts: row.attempts,
      final_status: row.status,
      technical: { webhook_event_id: row.id, provider: row.provider, event_type: row.event_type },
    })),
  ];
  const contactIds = [
    ...new Set(raw.map((item) => item.contact_id).filter((id): id is string => Boolean(id))),
  ];
  const sessionIds = [
    ...new Set(
      raw.map((item) => item.channel_session_id).filter((id): id is string => Boolean(id)),
    ),
  ];
  const [{ data: contacts }, { data: sessions }] = await Promise.all([
    contactIds.length
      ? admin
          .from("contacts")
          .select("id,name,display_name,phone_number")
          .eq("organization_id", orgId)
          .in("id", contactIds)
      : Promise.resolve({ data: [] }),
    sessionIds.length
      ? admin
          .from("channel_sessions")
          .select("id,display_name,phone_number")
          .eq("organization_id", orgId)
          .in("id", sessionIds)
      : Promise.resolve({ data: [] }),
  ]);
  const contactById = new Map((contacts ?? []).map((row) => [row.id, row]));
  const sessionById = new Map((sessions ?? []).map((row) => [row.id, row]));
  const items = raw
    .map((item) => {
      const category = classifyFailure(item.code, item.message, item.module);
      const contact = item.contact_id ? contactById.get(item.contact_id) : null;
      const session = item.channel_session_id ? sessionById.get(item.channel_session_id) : null;
      return {
        ...item,
        category,
        understandable_reason: understandableFailure(category, item.message ?? item.code),
        recommendation: failureRecommendation(category),
        contact: contact
          ? {
              id: contact.id,
              name: contact.name || contact.display_name || contact.phone_number,
              phone: contact.phone_number,
            }
          : null,
        connection: session
          ? {
              id: session.id,
              name: session.display_name || session.phone_number,
              phone: session.phone_number,
            }
          : null,
      };
    })
    .filter(
      (item) =>
        (!parsed.data.category || item.category === parsed.data.category) &&
        (!parsed.data.module || item.module === parsed.data.module),
    )
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, 500);
  const counts = items.reduce<Record<FailureCategory, number>>(
    (result, item) => ({ ...result, [item.category]: (result[item.category] ?? 0) + 1 }),
    {} as Record<FailureCategory, number>,
  );
  return ok({ items, counts, total: items.length, window: { from, to } }, { requestId });
}
