import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ action: z.enum(["validate", "approve_and_enable", "disable"]) });

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "webhook_sources" });
  if (!authz.ok) return authz.response;
  const { id } = await context.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Ação inválida.", 422, { requestId });
  const admin = createAdminClient();
  const { data: source } = await admin
    .from("webhook_sources")
    .select("*")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (!source) return fail("not_found", "Integração não encontrada.", 404, { requestId });
  const issues: string[] = [];
  if (source.create_opportunity && (!source.default_pipeline_id || !source.default_stage_id))
    issues.push("pipeline_etapa");
  if ((source.activate_ai || source.followup_flow_id) && !source.default_channel_session_id)
    issues.push("conexao");
  if (source.provider_type === "3c" && (!source.require_external_id || !source.secret_encrypted))
    issues.push("contrato_3c");
  if (source.followup_flow_id) {
    const { data: flow } = await admin
      .from("followup_flow_pointers")
      .select("status,active_version_id")
      .eq("id", source.followup_flow_id)
      .eq("organization_id", authz.org.orgId)
      .maybeSingle();
    if (flow?.status !== "active" || !flow.active_version_id) issues.push("cadencia_nao_publicada");
  }
  const now = new Date().toISOString();
  if (parsed.data.action === "validate") {
    await admin
      .from("webhook_sources")
      .update({ last_tested_at: now, last_test_status: issues.length ? "failed" : "passed" })
      .eq("id", id);
    return ok({ valid: issues.length === 0, issues }, { requestId });
  }
  if (parsed.data.action === "approve_and_enable" && issues.length)
    return fail("validation_failed", "A homologação encontrou pendências.", 422, {
      requestId,
      details: { issues },
    });
  const enabled = parsed.data.action === "approve_and_enable";
  await admin
    .from("webhook_sources")
    .update({
      automation_enabled: enabled,
      ...(enabled ? { pilot_approved_at: now, pilot_approved_by_user_id: authz.user.id } : {}),
      updated_at: now,
    })
    .eq("id", id);
  await audit({
    action: "webhook.source_updated",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "webhook_source",
    resourceId: id,
    requestId,
    metadata: { pilot_action: parsed.data.action, automation_enabled: enabled },
  });
  return ok(
    { automation_enabled: enabled, pilot_approved_at: enabled ? now : source.pilot_approved_at },
    { requestId },
  );
}
