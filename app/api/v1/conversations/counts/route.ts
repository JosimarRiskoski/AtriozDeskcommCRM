/**
 * GET /api/v1/conversations/counts — contagens por visão do inbox (G4-02).
 *
 * Usa o client user-scoped (cookie session) → toda contagem HERDA a RLS de
 * SELECT de `conversations` (fn_can_view_conversation, migration 0035). Um agent
 * em modo own* recebe a contagem do SEU escopo, NUNCA o total da org — a mesma
 * garantia do listing. A função fn_inbox_counts é SECURITY INVOKER, portanto não
 * ignora essas policies ao agregar os quatro totais em uma única consulta.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { loadConversationCounts } from "@/lib/inbox/counts";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const supabase = await createClient();

  const authUser = await loadAuthUser();
  if (!authUser) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }

  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) {
    return fail("no_active_org", "No active organization.", 403, { requestId });
  }

  let counts;
  try {
    counts = await loadConversationCounts(supabase, activeOrg.orgId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao contar conversas.";
    return fail("internal_error", message, 500, { requestId });
  }

  return ok(counts, { requestId });
}
