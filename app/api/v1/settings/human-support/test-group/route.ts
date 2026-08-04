import { randomUUID } from "node:crypto";
import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWAHA } from "@/lib/waha/send";

export async function POST() {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "human_support_settings" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("human_support_settings")
    .select("whatsapp_connection_id,whatsapp_group_chat_id,whatsapp_group_name")
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (!settings?.whatsapp_connection_id || !settings.whatsapp_group_chat_id)
    return fail("validation_failed", "Salve uma conexão e um grupo antes do teste.", 422, {
      requestId,
    });
  const { data: connection } = await admin
    .from("channel_sessions")
    .select("waha_session_name,status")
    .eq("id", settings.whatsapp_connection_id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (!connection || !["WORKING", "connected", "active", "online"].includes(connection.status))
    return fail("connection_unavailable", "A conexão escolhida não está disponível.", 409, {
      requestId,
    });
  const result = await sendWAHA({
    sessionName: connection.waha_session_name,
    chatId: settings.whatsapp_group_chat_id,
    text: `✅ Teste do CRM ${authz.org.name}\nOs avisos aos gestores estão configurados para este grupo.`,
  });
  if (!result)
    return fail("provider_unavailable", "O provedor do WhatsApp não está configurado.", 503, {
      requestId,
    });
  await audit({
    action: "human_support.group_test_sent",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "human_support_settings",
    resourceId: authz.org.orgId,
    requestId,
    metadata: {
      group_chat_id: settings.whatsapp_group_chat_id,
      group_name: settings.whatsapp_group_name,
    },
  });
  return ok({ sent: true }, { requestId });
}
