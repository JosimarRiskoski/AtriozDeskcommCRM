import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;

  const { user, org } = authz;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .update({ bot_silenced_until: "infinity" })
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .select("id, bot_silenced_until")
    .maybeSingle();

  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("not_found", "Conversa não encontrada.", 404, { requestId });

  await audit({
    action: "ai.paused_by_agent",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "conversation",
    resourceId: id,
    requestId,
    metadata: { reason: "manual_inbox_control" },
  });

  return ok({ paused: true, bot_silenced_until: data.bot_silenced_until }, { requestId });
}
