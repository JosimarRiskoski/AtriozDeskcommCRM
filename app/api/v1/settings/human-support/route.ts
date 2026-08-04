import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  DEFAULT_HUMAN_SUPPORT_SETTINGS,
  humanSupportSettingsSchema,
} from "@/lib/human-support/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "human_support_settings" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();
  const [{ data: row }, { data: connections }, { data: groups }] = await Promise.all([
    admin
      .from("human_support_settings")
      .select("*")
      .eq("organization_id", authz.org.orgId)
      .maybeSingle(),
    admin
      .from("channel_sessions")
      .select("id,display_name,phone_number,waha_session_name,status")
      .eq("organization_id", authz.org.orgId)
      .order("display_name"),
    admin
      .from("conversations")
      .select("group_chat_id,metadata,channel_session_id")
      .eq("organization_id", authz.org.orgId)
      .eq("is_group", true)
      .not("group_chat_id", "is", null),
  ]);
  const settings = humanSupportSettingsSchema
    .catch(DEFAULT_HUMAN_SUPPORT_SETTINGS)
    .parse(row ?? {});
  const uniqueGroups = new Map<
    string,
    { chat_id: string; name: string; channel_session_id: string }
  >();
  for (const group of groups ?? []) {
    if (!group.group_chat_id) continue;
    const metadata =
      group.metadata && typeof group.metadata === "object" && !Array.isArray(group.metadata)
        ? (group.metadata as Record<string, unknown>)
        : {};
    uniqueGroups.set(group.group_chat_id, {
      chat_id: group.group_chat_id,
      name: String(metadata.group_name ?? metadata.name ?? group.group_chat_id),
      channel_session_id: group.channel_session_id,
    });
  }
  return ok(
    { settings, connections: connections ?? [], groups: [...uniqueGroups.values()] },
    { requestId },
  );
}

export async function PUT(req: NextRequest) {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "human_support_settings" });
  if (!authz.ok) return authz.response;
  const parsed = humanSupportSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return fail("validation_failed", "Revise a configuração de atendimento humano.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  const admin = createAdminClient();
  if (parsed.data.whatsapp_connection_id) {
    const { data: connection } = await admin
      .from("channel_sessions")
      .select("id,status")
      .eq("id", parsed.data.whatsapp_connection_id)
      .eq("organization_id", authz.org.orgId)
      .maybeSingle();
    if (!connection)
      return fail(
        "validation_failed",
        "A conexão escolhida não pertence a esta organização.",
        422,
        { requestId },
      );
  }
  const { data, error } = await admin
    .from("human_support_settings")
    .upsert({
      ...parsed.data,
      organization_id: authz.org.orgId,
      updated_by_user_id: authz.user.id,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error)
    return fail("internal_error", "Não foi possível salvar as configurações.", 500, { requestId });
  await audit({
    action: "human_support.settings_changed",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "human_support_settings",
    resourceId: authz.org.orgId,
    requestId,
    metadata: {
      notify_in_app: parsed.data.notify_in_app,
      notify_email: parsed.data.notify_email,
      notify_whatsapp_group: parsed.data.notify_whatsapp_group,
      allow_group_replies: parsed.data.allow_group_replies,
    },
  });
  return ok(data, { requestId });
}
