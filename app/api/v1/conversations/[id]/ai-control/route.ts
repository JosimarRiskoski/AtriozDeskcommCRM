import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  mode: z.enum(["inherit", "force_active", "force_paused"]),
});

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Modo de IA inválido.", 422, { requestId });
  }

  const { user, org } = authz;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .update({ ai_control_mode: parsed.data.mode })
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .select("id, ai_control_mode")
    .maybeSingle();

  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("not_found", "Conversa não encontrada.", 404, { requestId });

  await audit({
    action: "ai.contact_control_changed",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "conversation",
    resourceId: id,
    requestId,
    metadata: { mode: parsed.data.mode },
  });

  return ok({ mode: data.ai_control_mode }, { requestId });
}
