import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth/require-role";
import { fail, ok } from "@/lib/api/wrappers";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ action: z.enum(["start", "pause", "resume", "cancel"]) });

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "outreach_campaigns" });
  if (!authz.ok) return authz.response;
  const { id } = await context.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(id).success) return fail("validation_failed", "Ação ou campanha inválida.", 422, { requestId });
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: current } = await admin.from("outreach_campaigns").select("id,status").eq("id", id).eq("organization_id", authz.org.orgId).maybeSingle();
  if (!current) return fail("not_found", "Campanha não encontrada.", 404, { requestId });
  const allowed: Record<string, string[]> = { start: ["draft"], pause: ["scheduled", "running"], resume: ["paused"], cancel: ["draft", "scheduled", "running", "paused"] };
  if (!(allowed[parsed.data.action] ?? []).includes(current.status)) return fail("conflict", `A campanha ${current.status} não aceita esta ação.`, 409, { requestId });
  const now = new Date().toISOString();
  const update = parsed.data.action === "start" ? { status: "scheduled", scheduled_for: now, next_dispatch_at: now, paused_at: null, updated_at: now }
    : parsed.data.action === "pause" ? { status: "paused", paused_at: now, updated_at: now }
    : parsed.data.action === "resume" ? { status: "running", paused_at: null, next_dispatch_at: now, updated_at: now }
    : { status: "cancelled", next_dispatch_at: null, updated_at: now };
  const { data, error } = await admin.from("outreach_campaigns").update(update).eq("id", id).eq("organization_id", authz.org.orgId).select("id,name,status,next_dispatch_at").single();
  if (error) return fail("internal_error", "Não foi possível alterar a campanha.", 500, { requestId });
  if (parsed.data.action === "cancel") await admin.from("outreach_campaign_recipients").update({ status: "cancelled", processing_lease_until: null, updated_at: now }).eq("campaign_id", id).in("status", ["pending", "processing"]);
  return ok(data, { requestId });
}
