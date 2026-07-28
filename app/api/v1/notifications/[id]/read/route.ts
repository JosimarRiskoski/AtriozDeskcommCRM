import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "notification_events" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { read?: boolean };
  const supabase = await createClient();
  const { data: event } = await supabase
    .from("notification_events" as never)
    .select("id")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (!event) return fail("not_found", "Notificação não encontrada.", 404, { requestId });
  const result = body.read === false
    ? await supabase
        .from("notification_reads" as never)
        .delete()
        .eq("event_id", id)
        .eq("user_id", authz.user.id)
    : await supabase
        .from("notification_reads" as never)
        .upsert({ event_id: id, user_id: authz.user.id, read_at: new Date().toISOString() } as never);
  if (result.error) return fail("internal_error", result.error.message, 500, { requestId });
  return ok({ read: body.read !== false }, { requestId });
}

