/**
 * GET /api/v1/conversations — list inbox (handler em ./_handler.ts).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { listConversationsQuerySchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

import { listConversationsHandler } from "./_handler";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const startedAt = performance.now();
  const supabase = await createClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }

  const authUser = await loadAuthUser();
  const activeOrg = authUser ? await resolveActiveOrg(authUser) : null;
  if (!activeOrg) {
    return fail("no_active_org", "No active organization.", 403, { requestId });
  }

  const url = new URL(req.url);
  const qsParsed = listConversationsQuerySchema.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    command: url.searchParams.get("command") ?? undefined,
    exclude_finished: url.searchParams.get("exclude_finished") === "true" ? true : undefined,
    assigned_to: url.searchParams.get("assigned_to") ?? undefined,
    channel_session_id: url.searchParams.get("channel_session_id") ?? undefined,
    include_archived_connections: url.searchParams.get("include_archived_connections") === "1",
    search: url.searchParams.get("search") ?? undefined,
    tag: url.searchParams.get("tag") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!qsParsed.success) {
    return fail("validation_failed", "Query inválida.", 422, {
      details: qsParsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  try {
    const { conversations, cursor, has_more } = await listConversationsHandler(
      supabase,
      {
        organization_id: activeOrg.orgId,
        actor: { type: "user", id: user.id },
        requestId,
      },
      qsParsed.data,
    );
    const elapsedMs = Math.round(performance.now() - startedAt);
    // O cabeçalho é deliberadamente só duração: facilita investigar lentidão no
    // navegador sem expor texto de mensagens, telefones ou filtros buscados.
    return ok(conversations, {
      requestId,
      meta: { cursor, has_more },
      headers: { "Server-Timing": `inbox;dur=${elapsedMs}` },
    });
  } catch (err) {
    const elapsedMs = Math.round(performance.now() - startedAt);
    if (err instanceof ApiError) {
      logger.warn("[inbox.list] request failed", {
        request_id: requestId,
        status: err.status,
        code: err.code,
        duration_ms: elapsedMs,
        has_search: Boolean(qsParsed.data.search),
        has_cursor: Boolean(qsParsed.data.cursor),
      });
      return fail(err.code, err.message, err.status, { requestId });
    }
    logger.error("[inbox.list] request crashed", {
      request_id: requestId,
      duration_ms: elapsedMs,
      error_type: err instanceof Error ? err.name : typeof err,
    });
    throw err;
  }
}
