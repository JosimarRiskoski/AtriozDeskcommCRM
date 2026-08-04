import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import {
  summarizeServiceMode,
  type ConversationPerformanceFact,
} from "@/lib/metrics/human-ai-comparison";
import { createAdminClient } from "@/lib/supabase/admin";

const querySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  origin: z.string().max(80).optional(),
});
const settingsSchema = z.object({
  human_hourly_cost_cents: z.number().int().min(0).max(100_000_000).nullable(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "metrics_human_ai" });
  if (!authz.ok) return authz.response;
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!parsed.success) return fail("validation_failed", "Filtros inválidos.", 422, { requestId });
  const to = parsed.data.to ?? new Date().toISOString();
  const from = parsed.data.from ?? new Date(Date.now() - 30 * 86400_000).toISOString();
  const admin = createAdminClient() as unknown as SupabaseClient;
  const orgId = authz.org.orgId;
  const [
    { data: settings },
    { data: messages, error: messageError },
    { data: runs, error: runError },
  ] = await Promise.all([
    admin
      .from("performance_comparison_settings")
      .select("human_hourly_cost_cents,currency")
      .eq("organization_id", orgId)
      .maybeSingle(),
    admin
      .from("messages")
      .select("id,conversation_id,direction,sent_at,sent_by_user_id,status")
      .eq("organization_id", orgId)
      .gte("sent_at", from)
      .lte("sent_at", to)
      .order("sent_at", { ascending: true })
      .limit(20_000),
    admin
      .from("ai_agent_runs")
      .select("id,conversation_id,status,started_at,completed_at,cost_cents,outbound_message_id")
      .eq("organization_id", orgId)
      .gte("started_at", from)
      .lte("started_at", to)
      .limit(20_000),
  ]);
  if (messageError || runError)
    return fail("internal_error", "Não foi possível calcular o comparativo.", 500, { requestId });
  // O período é definido pela atividade, não pela data em que a conversa foi
  // criada. Assim uma conversa antiga que recebeu/respondeu hoje entra hoje.
  const conversationIds = [
    ...new Set([
      ...(messages ?? []).map((row) => row.conversation_id),
      ...(runs ?? []).map((row) => row.conversation_id).filter((id): id is string => !!id),
    ]),
  ];
  const { data: conversations, error } = conversationIds.length
    ? await admin
        .from("conversations")
        .select("id,contact_id,status,status_changed_at,last_handoff_at,created_at")
        .eq("organization_id", orgId)
        .in("id", conversationIds)
        .limit(3000)
    : { data: [], error: null };
  if (error)
    return fail("internal_error", "Não foi possível calcular o comparativo.", 500, { requestId });
  const contactIds = [...new Set((conversations ?? []).map((row) => row.contact_id))];
  const [{ data: contacts }, { data: leads }, { data: closedAudits }] = await Promise.all([
    contactIds.length
      ? admin.from("contacts").select("id,source").eq("organization_id", orgId).in("id", contactIds)
      : Promise.resolve({ data: [] }),
    contactIds.length
      ? admin
          .from("crm_leads")
          .select("contact_id,status,closed_at")
          .eq("organization_id", orgId)
          .in("contact_id", contactIds)
      : Promise.resolve({ data: [] }),
    conversationIds.length
      ? admin
          .from("api_audit_log")
          .select("resource_id,created_at")
          .eq("organization_id", orgId)
          .eq("resource_type", "conversation")
          .eq("action", "conversation.closed")
          .in("resource_id", conversationIds)
      : Promise.resolve({ data: [] }),
  ]);
  const sourceByContact = new Map(
    (contacts ?? []).map((row) => [row.id, row.source || "desconhecida"]),
  );
  const messagesByConversation = new Map<string, typeof messages>();
  for (const message of messages ?? [])
    messagesByConversation.set(message.conversation_id, [
      ...(messagesByConversation.get(message.conversation_id) ?? []),
      message,
    ]);
  const runsByConversation = new Map<string, typeof runs>();
  for (const run of runs ?? [])
    if (run.conversation_id)
      runsByConversation.set(run.conversation_id, [
        ...(runsByConversation.get(run.conversation_id) ?? []),
        run,
      ]);
  const leadsByContact = new Map<string, typeof leads>();
  for (const lead of leads ?? [])
    if (lead.contact_id)
      leadsByContact.set(lead.contact_id, [...(leadsByContact.get(lead.contact_id) ?? []), lead]);
  const closedBefore = new Set((closedAudits ?? []).map((row) => row.resource_id));
  const facts: ConversationPerformanceFact[] = [];
  const origins = new Set<string>();
  for (const conversation of conversations ?? []) {
    const origin = sourceByContact.get(conversation.contact_id) ?? "desconhecida";
    origins.add(origin);
    if (parsed.data.origin && origin !== parsed.data.origin) continue;
    const conversationMessages = messagesByConversation.get(conversation.id) ?? [];
    const firstInbound = conversationMessages.find(
      (message) => message.direction === "inbound",
    )?.sent_at;
    if (!firstInbound) continue;
    const firstInboundTime = new Date(firstInbound).getTime();
    const humanResponse = conversationMessages.find(
      (message) =>
        message.direction === "outbound" &&
        message.sent_by_user_id &&
        new Date(message.sent_at).getTime() >= firstInboundTime,
    );
    const conversationRuns = runsByConversation.get(conversation.id) ?? [];
    const aiResponse = conversationRuns
      .filter((run) => run.outbound_message_id && ["completed", "handoff"].includes(run.status))
      .sort((a, b) => a.started_at.localeCompare(b.started_at))[0];
    const won = (leadsByContact.get(conversation.contact_id) ?? []).some(
      (lead) =>
        lead.status === "won" &&
        (!lead.closed_at || (lead.closed_at >= from && lead.closed_at <= to)),
    );
    const statusChangedAt = new Date(conversation.status_changed_at).getTime();
    const resolvedAt =
      conversation.status === "closed" && statusChangedAt <= new Date(to).getTime()
        ? statusChangedAt
        : null;
    const reopened = conversation.status !== "closed" && closedBefore.has(conversation.id);
    if (humanResponse) {
      const responseTime = new Date(humanResponse.sent_at).getTime();
      const workedSeconds =
        resolvedAt && resolvedAt >= responseTime ? (resolvedAt - responseTime) / 1000 : null;
      facts.push({
        mode: "human",
        firstResponseSeconds: Math.max(0, (responseTime - firstInboundTime) / 1000),
        resolutionSeconds: resolvedAt ? Math.max(0, (resolvedAt - firstInboundTime) / 1000) : null,
        converted: won,
        handoff: false,
        reopened,
        costCents:
          workedSeconds !== null && settings?.human_hourly_cost_cents != null
            ? Math.round((workedSeconds / 3600) * settings.human_hourly_cost_cents)
            : null,
      });
    }
    if (aiResponse) {
      const responseTime = new Date(aiResponse.completed_at ?? aiResponse.started_at).getTime();
      facts.push({
        mode: "ai",
        firstResponseSeconds: Math.max(0, (responseTime - firstInboundTime) / 1000),
        resolutionSeconds: resolvedAt ? Math.max(0, (resolvedAt - firstInboundTime) / 1000) : null,
        converted: won,
        handoff: Boolean(conversation.last_handoff_at),
        reopened,
        costCents: conversationRuns.reduce((sum, run) => sum + Number(run.cost_cents ?? 0), 0),
      });
    }
  }
  return ok(
    {
      window: { from, to },
      origin: parsed.data.origin ?? null,
      origins: [...origins].sort(),
      human: summarizeServiceMode(facts.filter((fact) => fact.mode === "human")),
      ai: summarizeServiceMode(facts.filter((fact) => fact.mode === "ai")),
      settings: {
        human_hourly_cost_cents: settings?.human_hourly_cost_cents ?? null,
        currency: settings?.currency ?? "BRL",
      },
      quality_formula:
        "55% resolução + 35% conversão + base de 10%, com penalidades por reabertura e handoff da IA.",
    },
    { requestId },
  );
}

export async function PUT(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "metrics_human_ai" });
  if (!authz.ok) return authz.response;
  const parsed = settingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return fail("validation_failed", "Custo por hora inválido.", 422, { requestId });
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await admin
    .from("performance_comparison_settings")
    .upsert({
      organization_id: authz.org.orgId,
      human_hourly_cost_cents: parsed.data.human_hourly_cost_cents,
      updated_by_user_id: authz.user.id,
      updated_at: new Date().toISOString(),
    })
    .select("human_hourly_cost_cents,currency")
    .single();
  if (error) return fail("internal_error", "Não foi possível salvar o custo.", 500, { requestId });
  await audit({
    action: "performance.settings_updated",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "performance_comparison_settings",
    resourceId: authz.org.orgId,
    requestId,
    metadata: { human_hourly_cost_cents: parsed.data.human_hourly_cost_cents },
  });
  return ok(data, { requestId });
}
