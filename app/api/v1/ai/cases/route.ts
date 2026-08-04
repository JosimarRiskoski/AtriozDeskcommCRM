/**
 * GET /api/v1/ai/cases — lista os casos humanos da org (spec 15 §7, Wave 5).
 * Read-only via PostgREST (`createAdminClient`) — a escrita de estado do caso
 * mora em POST /api/v1/ai/cases/[id]/reply (pg.Pool do engine, ver ADR ali).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const OPEN_STATUSES = ["awaiting_human", "awaiting_lead"] as const;
const RESOLVED_STATUSES = ["resolved", "escalated", "cancelled"] as const;

const querySchema = z.object({
  status: z
    .enum(["open", "awaiting_human", "awaiting_lead", "escalated", "resolved"])
    .default("open"),
  assignee_user_id: z.string().uuid().optional(),
  urgency: z.enum(["low", "normal", "high", "critical"]).optional(),
  agent_id: z.string().uuid().optional(),
  opened_for: z.enum(["all", "overdue", "24h", "7d"]).default("all"),
  conversation_id: z.string().uuid().optional(),
});

const createSchema = z.object({
  conversation_id: z.string().uuid(),
  title: z.string().trim().min(3).max(160),
  summary: z.string().trim().min(3).max(2_000),
  blocker: z.string().trim().min(3).max(1_000),
  urgency: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  assignee_user_id: z.string().uuid().nullable().optional(),
  include_conversation_link: z.boolean().default(true),
  notify_manager_group: z.boolean().default(false),
});

type CaseRow = {
  id: string;
  title: string;
  summary: string;
  blocker: string;
  status: string;
  opened_at: string;
  conversation_id: string;
  assignee_user_id: string | null;
  urgency: string;
  category: string;
  reason_code: string;
  first_response_due_at: string | null;
  escalation_due_at: string | null;
  agent_id: string | null;
  ai_agents: { name: string } | null;
  conversations: { contacts: { name: string | null; phone_number: string | null } | null } | null;
};

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "agent_cases" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()));
  if (!parsed.success) {
    return fail("validation_failed", "Query inválida.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const statuses =
    parsed.data.status === "open"
      ? [...OPEN_STATUSES, "escalated"]
      : parsed.data.status === "resolved"
        ? ["resolved", "cancelled"]
        : [parsed.data.status];

  const admin = createAdminClient();
  let query = admin
    .from("agent_cases")
    .select(
      "id, title, summary, blocker, status, opened_at, conversation_id, assignee_user_id, urgency, category, reason_code, first_response_due_at, escalation_due_at, agent_id, ai_agents:agent_id(name), conversations:conversation_id(contacts:contact_id(name, phone_number))",
    )
    .eq("organization_id", org.orgId)
    .in("status", statuses)
    .order("opened_at", { ascending: false });
  if (parsed.data.assignee_user_id)
    query = query.eq("assignee_user_id", parsed.data.assignee_user_id);
  if (parsed.data.urgency) query = query.eq("urgency", parsed.data.urgency);
  if (parsed.data.agent_id) query = query.eq("agent_id", parsed.data.agent_id);
  if (parsed.data.conversation_id) query = query.eq("conversation_id", parsed.data.conversation_id);
  const now = Date.now();
  if (parsed.data.opened_for === "overdue")
    query = query.lt("first_response_due_at", new Date(now).toISOString());
  if (parsed.data.opened_for === "24h")
    query = query.lte("opened_at", new Date(now - 86_400_000).toISOString());
  if (parsed.data.opened_for === "7d")
    query = query.lte("opened_at", new Date(now - 7 * 86_400_000).toISOString());
  const { data, error } = await query;
  if (error) {
    return fail("internal_error", "Falha ao carregar os casos.", 500, { requestId });
  }

  const rows = (data ?? []) as unknown as CaseRow[];
  const assigneeIds = [
    ...new Set(rows.map((r) => r.assignee_user_id).filter((id): id is string => !!id)),
  ];
  const assigneeNames = new Map<string, string>();
  await Promise.all(
    assigneeIds.map(async (id) => {
      const { data: result } = await admin.auth.admin.getUserById(id);
      const user = result?.user;
      if (user)
        assigneeNames.set(
          id,
          (user.user_metadata?.full_name as string | undefined) ?? user.email ?? id,
        );
    }),
  );
  const cases = rows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    blocker: r.blocker,
    status: r.status,
    opened_at: r.opened_at,
    conversation_id: r.conversation_id,
    assignee_user_id: r.assignee_user_id,
    assignee_name: r.assignee_user_id ? (assigneeNames.get(r.assignee_user_id) ?? null) : null,
    urgency: r.urgency,
    category: r.category,
    reason_code: r.reason_code,
    first_response_due_at: r.first_response_due_at,
    escalation_due_at: r.escalation_due_at,
    agent_id: r.agent_id,
    agent_name: r.ai_agents?.name ?? null,
    contact_name: r.conversations?.contacts?.name ?? null,
    contact_phone: r.conversations?.contacts?.phone_number ?? null,
  }));

  const { count: openCount } = await admin
    .from("agent_cases")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.orgId)
    .in("status", [...OPEN_STATUSES, "escalated"]);

  return ok({ cases, open_count: openCount ?? 0 }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "agent_cases" });
  if (!authz.ok) return authz.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("validation_failed", "Dados inválidos.", 422, { requestId });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Preencha título, resumo e motivo do caso.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const admin = createAdminClient();
  const { data: conversation } = await admin
    .from("conversations")
    .select("id,contact_id")
    .eq("id", parsed.data.conversation_id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (!conversation) return fail("not_found", "Conversa não encontrada.", 404, { requestId });

  if (parsed.data.assignee_user_id) {
    const { data: member } = await admin
      .from("user_organizations")
      .select("user_id,role")
      .eq("organization_id", authz.org.orgId)
      .eq("user_id", parsed.data.assignee_user_id)
      .is("revoked_at", null)
      .maybeSingle();
    if (!member || member.role === "viewer")
      return fail("validation_failed", "O responsável escolhido não pode atender casos.", 422, {
        requestId,
      });
  }

  const { data: existing } = await admin
    .from("agent_cases")
    .select("id")
    .eq("organization_id", authz.org.orgId)
    .eq("conversation_id", conversation.id)
    .in("status", ["awaiting_human", "awaiting_lead", "escalated"])
    .limit(1)
    .maybeSingle();
  if (existing) {
    return fail("conflict", "Esta conversa já possui um caso humano aberto.", 409, {
      requestId,
      details: { case_id: existing.id },
    });
  }

  const { data: created, error } = await admin
    .from("agent_cases")
    .insert({
      organization_id: authz.org.orgId,
      conversation_id: conversation.id,
      title: parsed.data.title,
      summary: parsed.data.summary,
      blocker: parsed.data.blocker,
      status: "awaiting_human",
      source: "manual",
      urgency: parsed.data.urgency,
      category: "other",
      reason_code: "manual",
      assignee_user_id: parsed.data.assignee_user_id ?? null,
      context_snapshot: {
        urgency: parsed.data.urgency,
        opened_by_user_id: authz.user.id,
        include_conversation_link: parsed.data.include_conversation_link,
        conversation_url: parsed.data.include_conversation_link
          ? `/app/inbox/${conversation.id}`
          : null,
        notify_manager_group: parsed.data.notify_manager_group,
      },
    })
    .select("id,title,status,opened_at")
    .single();
  if (error || !created) {
    return fail("internal_error", "Não foi possível criar o caso humano.", 500, {
      requestId,
    });
  }

  await admin.from("agent_case_events").insert({
    organization_id: authz.org.orgId,
    case_id: created.id,
    kind: "opened",
    actor_kind: "human",
    actor_user_id: authz.user.id,
    body: parsed.data.summary,
    metadata: { urgency: parsed.data.urgency, source: "manual" },
  });

  await audit({
    action: "human_case.created",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "agent_case",
    resourceId: created.id,
    requestId,
    metadata: {
      conversation_id: conversation.id,
      contact_id: conversation.contact_id,
      urgency: parsed.data.urgency,
      source: "manual",
      assignee_user_id: parsed.data.assignee_user_id ?? null,
      notify_manager_group: parsed.data.notify_manager_group,
    },
  });

  return ok(created, { requestId, status: 201 });
}
