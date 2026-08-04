/**
 * GET /api/v1/audit — list audit log entries for the active organization.
 *
 * Auth: cookie session, role manager+ (or platform admin).
 * Filters: actor_id, action (substring), resource_type, from, to, cursor, limit.
 * Pagination: keyset over (created_at DESC, id DESC).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isServiceRoleConfigured } from "@/lib/audit";
import { auditQuerySchema, decodeAuditCursor, encodeAuditCursor } from "@/lib/schemas/audit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", {
    requestId,
    resource: "audit",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const parsed = auditQuerySchema.safeParse(params);
  if (!parsed.success) {
    return fail("validation_failed", "Query inválida.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const q = parsed.data;

  const supabase = await createClient();
  let query = supabase
    .from("api_audit_log")
    .select(
      "id, created_at, actor_user_id, actor_api_token_id, acting_as_platform_admin, action, resource_type, resource_id, request_id, metadata, actor_ip, actor_user_agent",
    )
    .eq("organization_id", activeOrg.orgId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(q.limit + 1);

  if (q.actor_id) query = query.eq("actor_user_id", q.actor_id);
  if (q.action) query = query.ilike("action", `%${q.action}%`);
  if (q.resource_type) query = query.eq("resource_type", q.resource_type);
  if (q.from) query = query.gte("created_at", q.from);
  if (q.to) query = query.lte("created_at", q.to);

  if (q.cursor) {
    const c = decodeAuditCursor(q.cursor);
    if (!c) return fail("invalid_cursor", "Cursor inválido.", 400, { requestId });
    // (created_at, id) < (cursor.created_at, cursor.id) — keyset DESC
    query = query.or(
      `created_at.lt.${c.created_at},and(created_at.eq.${c.created_at},id.lt.${c.id})`,
    );
  }

  const { data, error } = await query;
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const rows = data ?? [];
  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;
  const userIds = [
    ...new Set(page.map((row) => row.actor_user_id).filter((id): id is string => Boolean(id))),
  ];
  const tokenIds = [
    ...new Set(page.map((row) => row.actor_api_token_id).filter((id): id is string => Boolean(id))),
  ];
  const userNames = new Map<string, string>();
  const tokenNames = new Map<string, string>();
  if (isServiceRoleConfigured()) {
    const admin = createAdminClient();
    await Promise.all(
      userIds.map(async (id) => {
        const { data } = await admin.auth.admin.getUserById(id);
        const user = data.user;
        if (user)
          userNames.set(
            id,
            String(user.user_metadata?.full_name || user.email || `Usuário ${id.slice(0, 8)}`),
          );
      }),
    );
    if (tokenIds.length) {
      const { data: tokens } = await admin
        .from("api_tokens")
        .select("id,name,prefix")
        .eq("organization_id", activeOrg.orgId)
        .in("id", tokenIds);
      for (const token of tokens ?? []) tokenNames.set(token.id, token.name || token.prefix);
    }
  }
  const enrichedPage = page.map((row) => {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const inferred = row.actor_user_id
      ? {
          type: "usuario",
          name: userNames.get(row.actor_user_id) ?? `Usuário ${row.actor_user_id.slice(0, 8)}`,
        }
      : row.actor_api_token_id
        ? {
            type: "integracao",
            name:
              tokenNames.get(row.actor_api_token_id) ??
              `Integração ${row.actor_api_token_id.slice(0, 8)}`,
          }
        : row.action.startsWith("ai.") || row.resource_type?.startsWith("ai_")
          ? { type: "ia", name: String(metadata.agent_name || "IA") }
          : row.action.startsWith("webhook.") || row.resource_type === "webhook_source"
            ? { type: "webhook", name: String(metadata.webhook_source_name || "Webhook") }
            : { type: "sistema", name: "Sistema" };
    return { ...row, actor: inferred };
  });
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeAuditCursor({ created_at: last.created_at, id: last.id }) : null;

  return ok(enrichedPage, {
    requestId,
    meta: { cursor: nextCursor, has_more: hasMore },
  });
}
