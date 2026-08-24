import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { evolutionFriendlyError, getEvolutionClient } from "@/lib/evolution/client";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "human_support_settings" });
  if (!authz.ok) return authz.response;
  const body = (await req.json().catch(() => null)) as { connection_id?: string } | null;
  if (!body?.connection_id) {
    return fail("validation_failed", "Escolha uma conexão antes de buscar os grupos.", 422, { requestId });
  }

  const admin = createAdminClient();
  const { data: connection } = await admin
    .from("channel_sessions")
    .select("id,external_session_name,status,archived_at")
    .eq("id", body.connection_id)
    .eq("organization_id", authz.org.orgId)
    .eq("provider", "evolution")
    .maybeSingle();
  if (!connection || connection.archived_at) {
    return fail("not_found", "Conexão ativa não encontrada.", 404, { requestId });
  }
  const evolution = getEvolutionClient();
  if (!evolution) {
    return fail("integration_not_configured", "Evolution API não configurada.", 503, { requestId });
  }
  try {
    const groups = await evolution.fetchAllGroups(connection.external_session_name);
    return ok(
      groups.map((group) => ({
        chat_id: group.chatId,
        name: group.name,
        channel_session_id: connection.id,
      })),
      { requestId },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail("integration_error", evolutionFriendlyError(message), 502, { requestId });
  }
}
