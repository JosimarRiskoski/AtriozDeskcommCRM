import type { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { enqueueJob } from "@/lib/agent-engine/queue/queue";
import { markAwaitingLead, resolveCaseFromHuman } from "@/lib/agent-engine/agent/human-cases";
import { parseManagerGroupCommand } from "@/lib/human-support/group-command-parser";
import { sendWhatsAppText, type WhatsAppProvider } from "@/lib/whatsapp/send";

type Admin = ReturnType<typeof createAdminClient>;
const digits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");

/** Processa só comandos delimitados; texto livre nunca entra no Inbox/IA. */
export async function handleManagerGroupCommand(input: {
  admin: Admin;
  organizationId: string;
  sessionId: string;
  sessionName: string | null | undefined;
  provider?: WhatsAppProvider;
  groupChatId: string;
  senderChatId: string | null | undefined;
  body: string | null | undefined;
  externalId: string | null | undefined;
  requestId: string;
}): Promise<boolean> {
  const { data: settings } = await input.admin
    .from("human_support_settings")
    .select(
      "allow_group_replies,authorized_manager_phones,whatsapp_connection_id,whatsapp_group_chat_id",
    )
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (
    !settings ||
    settings.whatsapp_connection_id !== input.sessionId ||
    settings.whatsapp_group_chat_id !== input.groupChatId
  )
    return false;
  const senderPhone = digits(input.senderChatId);
  const authorized =
    settings.allow_group_replies &&
    (settings.authorized_manager_phones as string[]).some(
      (phone: string) => digits(phone) === senderPhone,
    );
  const parsed = parseManagerGroupCommand(input.body);
  if (!authorized || !parsed) {
    await audit({
      action: "human_support.group_command_rejected",
      organizationId: input.organizationId,
      resourceType: "human_support_settings",
      resourceId: input.organizationId,
      requestId: input.requestId,
      metadata: {
        reason: !authorized ? "sender_not_authorized" : "free_text_or_invalid_command",
        sender_last4: senderPhone.slice(-4),
        external_id: input.externalId,
      },
    });
    if (authorized && !parsed && input.sessionName) {
      await sendWhatsAppText({
        provider: input.provider ?? "evolution",
        sessionName: input.sessionName,
        chatId: input.groupChatId,
        text: "Comando não reconhecido. Use: CASO <id> RESOLVER <resposta> ou CASO <id> PEDIR <informação necessária>. Respostas livres não são enviadas ao cliente.",
      });
    }
    return true;
  }
  const users = await input.admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const authUser = users.data.users.find((user) => digits(user.phone) === senderPhone);
  if (!authUser) return true;
  const { data: member } = await input.admin
    .from("user_organizations")
    .select("role,revoked_at,accepted_at")
    .eq("organization_id", input.organizationId)
    .eq("user_id", authUser.id)
    .maybeSingle();
  if (
    !member ||
    member.revoked_at ||
    !member.accepted_at ||
    !["manager", "admin"].includes(member.role)
  )
    return true;
  const { caseId, action, body } = parsed;
  const pool = getRequestPool();
  const { rows } = await pool.query<{ status: string; contact_id: string | null }>(
    `select ac.status,c.contact_id from agent_cases ac join conversations c on c.id=ac.conversation_id and c.organization_id=ac.organization_id where ac.organization_id=$1 and ac.id=$2`,
    [input.organizationId, caseId],
  );
  const row = rows[0];
  if (!row || row.status !== "awaiting_human" || !row.contact_id) return true;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const changed =
      action === "RESOLVER"
        ? await resolveCaseFromHuman(client, input.organizationId, caseId, authUser.id, body)
        : await markAwaitingLead(client, input.organizationId, caseId, authUser.id, body);
    if (!changed) {
      await client.query("rollback");
      return true;
    }
    await enqueueJob(client, input.organizationId, {
      kind: "case_reply_turn",
      leadId: row.contact_id,
      sourceEventId: input.externalId ? `manager-group:${input.externalId}` : undefined,
      payload: {
        case_id: caseId,
        action: action === "RESOLVER" ? "resolved" : "need_lead_info",
        body,
      },
    });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  await audit({
    action: "human_support.group_command_executed",
    actorUserId: authUser.id,
    organizationId: input.organizationId,
    resourceType: "agent_case",
    resourceId: caseId,
    requestId: input.requestId,
    metadata: {
      action: action.toLowerCase(),
      external_id: input.externalId,
      sender_last4: senderPhone.slice(-4),
    },
  });
  return true;
}
