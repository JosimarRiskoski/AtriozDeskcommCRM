/**
 * GET /api/v1/ai/usage — observability dashboard for AI invocations.
 *
 * Aggregates `ai_invocations` (cost, tokens, latency p50/p95, count) per day,
 * plus a per-day handoff rate (handoffs from `event_log` / inbound messages).
 *
 * Auth: cookie session, role manager+. organization_id resolved from JWT.
 *
 * Aggregation is done in TypeScript (see `lib/ai/usage/aggregate.ts`) so this
 * stays portable and unit-testable. We use the user-scoped client so RLS
 * enforces tenant isolation; the explicit organization_id filter is defense
 * in depth and required by repo convention.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import type { UsagePayload } from "@/lib/ai/usage/aggregate";

export const dynamic = "force-dynamic";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 90;

const querySchema = z.object({
  agent_id: z.string().uuid().optional(),
  invocation_kind: z.string().min(1).max(64).optional(),
  from: z.string().regex(DAY_RE).optional(),
  to: z.string().regex(DAY_RE).optional(),
});

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

function parseDayUtc(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

function resolveRange(qs: { from?: string; to?: string }): { from: Date; to: Date } {
  const now = new Date();
  const to = qs.to ? parseDayUtc(qs.to) : startOfUtcDay(now);
  let from = qs.from
    ? parseDayUtc(qs.from)
    : startOfUtcDay(new Date(now.getTime() - 29 * 86_400_000));

  // Hard-cap range to MAX_RANGE_DAYS.
  const diffDays = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  if (diffDays > MAX_RANGE_DAYS - 1) {
    from = new Date(to.getTime() - (MAX_RANGE_DAYS - 1) * 86_400_000);
  }
  if (from.getTime() > to.getTime()) {
    from = to;
  }
  return { from: startOfUtcDay(from), to: startOfUtcDay(to) };
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("manager", { requestId, resource: "ai_usage" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return fail("validation_failed", "Filtros inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const range = resolveRange(parsed.data);
  const fromIso = range.from.toISOString();
  const toIso = endOfUtcDay(range.to).toISOString();

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("fn_ai_usage_summary", {
    p_organization_id: activeOrg.orgId,
    p_from: fromIso,
    p_to: toIso,
    p_agent_id: parsed.data.agent_id ?? null,
    p_invocation_kind: parsed.data.invocation_kind ?? null,
  });
  if (error || !data) {
    console.warn("[ai-usage] server aggregation failed", { error: error?.message });
    return fail("internal_error", "Não foi possível calcular o uso da IA.", 500, { requestId });
  }

  const payload = data as unknown as UsagePayload;

  return ok(payload, { requestId });
}
