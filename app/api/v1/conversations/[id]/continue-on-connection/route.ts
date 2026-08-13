import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  connection_id: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
  context_message: z.string().trim().min(3).max(2000),
  confirm: z.literal(true),
});

async function loadContext(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  conversationId: string,
) {
  const { data: conversation } = await admin
    .from("conversations")
    .select(
      "id,contact_id,channel_session_id,last_message_preview,channel_sessions:channel_session_id(display_name,phone_number,status),contacts:contact_id(name,display_name,phone_number,is_blocked)",
    )
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!conversation) return null;
  const row = conversation as unknown as {
    id: string;
    contact_id: string;
    channel_session_id: string;
    last_message_preview: string | null;
    channel_sessions: {
      display_name: string | null;
      phone_number: string | null;
      status: string;
    } | null;
    contacts: {
      name: string | null;
      display_name: string | null;
      phone_number: string | null;
      is_blocked: boolean;
    } | null;
  };
  const { data: messages } = await admin
    .from("messages")
    .select("direction,body,sent_at")
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: false })
    .limit(6);
  const summary = (messages ?? [])
    .slice()
    .reverse()
    .map(
      (message) =>
        `${message.direction === "inbound" ? "Cliente" : "Atendimento"}: ${message.body ?? "[mídia]"}`,
    )
    .join("\n");
  const contactName = row.contacts?.name ?? row.contacts?.display_name ?? "cliente";
  return {
    ...row,
    summary,
    suggested_message: `Olá, ${contactName}. Nossa conexão anterior ficou indisponível e continuaremos seu atendimento por este número.\n\nResumo para continuidade: ${row.last_message_preview ?? "atendimento em andamento"}`,
  };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  const admin = createAdminClient();
  const current = await loadContext(admin, authz.org.orgId, id);
  if (!current) return fail("not_found", "Conversa não encontrada.", 404, { requestId });
  if (current.contacts?.is_blocked)
    return fail("forbidden", "O contato está bloqueado para qualquer comunicação.", 403, {
      requestId,
    });
  if (["WORKING", "connected", "active", "online"].includes(current.channel_sessions?.status ?? ""))
    return fail(
      "state_conflict",
      "A conexão atual ainda está disponível. A troca só é permitida quando ela estiver indisponível.",
      409,
      { requestId },
    );
  const { data: candidates } = await admin
    .from("channel_sessions")
    .select("id,display_name,phone_number,status")
    .eq("organization_id", authz.org.orgId)
    .is("archived_at", null)
    .neq("id", current.channel_session_id)
    .in("status", ["WORKING", "connected", "active", "online"]);
  return ok(
    {
      current_connection: current.channel_sessions,
      contact: current.contacts,
      recent_summary: current.summary,
      suggested_message: current.suggested_message,
      candidates: candidates ?? [],
    },
    { requestId },
  );
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const input = schema.safeParse(await req.json().catch(() => null));
  if (!input.success)
    return fail("validation_failed", "Confirme a conexão, a mensagem e o motivo.", 422, {
      requestId,
    });
  const { id } = await ctx.params;
  const admin = createAdminClient();
  const current = await loadContext(admin, authz.org.orgId, id);
  if (!current) return fail("not_found", "Conversa não encontrada.", 404, { requestId });
  if (current.contacts?.is_blocked)
    return fail("forbidden", "O contato está bloqueado para qualquer comunicação.", 403, {
      requestId,
    });
  if (["WORKING", "connected", "active", "online"].includes(current.channel_sessions?.status ?? ""))
    return fail(
      "state_conflict",
      "A conexão atual voltou a funcionar; a continuidade não foi criada.",
      409,
      { requestId },
    );
  const { data: target } = await admin
    .from("channel_sessions")
    .select("id,status")
    .eq("id", input.data.connection_id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (!target || !["WORKING", "connected", "active", "online"].includes(target.status))
    return fail("connection_unavailable", "A nova conexão não está disponível.", 409, {
      requestId,
    });
  const { data: toConversationId, error: convError } = await admin.rpc(
    "fn_upsert_wa_conversation",
    { p_org: authz.org.orgId, p_contact: current.contact_id, p_session: target.id },
  );
  if (convError || !toConversationId)
    return fail("internal_error", "Não foi possível preparar a nova conversa.", 500, { requestId });
  const message = await sendMessageHandler(
    admin as unknown as SupabaseClient,
    { organization_id: authz.org.orgId, actor: { type: "user", id: authz.user.id }, requestId },
    { conversation_id: toConversationId, type: "text", body: input.data.context_message },
  );
  if (message.status === "failed")
    return fail(
      "provider_error",
      "A nova conversa foi criada, mas a mensagem não pôde ser enviada.",
      502,
      { requestId, details: { conversation_id: toConversationId, message_id: message.id } },
    );
  const db = admin as unknown as SupabaseClient;
  await db.from("conversation_continuations").insert({
    organization_id: authz.org.orgId,
    contact_id: current.contact_id,
    from_conversation_id: id,
    to_conversation_id: toConversationId,
    from_connection_id: current.channel_session_id,
    to_connection_id: target.id,
    reason: input.data.reason,
    context_message: input.data.context_message,
    created_by_user_id: authz.user.id,
  });
  await audit({
    action: "conversation.continued_on_connection",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "conversation",
    resourceId: toConversationId,
    requestId,
    metadata: {
      from_conversation_id: id,
      from_connection_id: current.channel_session_id,
      to_connection_id: target.id,
      reason: input.data.reason,
    },
  });
  return ok(
    { conversation_id: toConversationId, message_id: message.id, status: message.status },
    { requestId, status: 201 },
  );
}
