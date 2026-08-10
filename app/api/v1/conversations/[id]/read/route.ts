import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { getEvolutionClient } from "@/lib/evolution/client";
import { buildEvolutionReadKeys } from "@/lib/evolution/read-receipts";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function POST(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: conversationId } = await ctx.params;
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id, organization_id, channel_session_id, contacts:contact_id(phone_number)")
    .eq("id", conversationId)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (conversationError) {
    return fail("internal_error", "Erro ao abrir a conversa.", 500, { requestId });
  }
  if (!conversation) {
    return fail("not_found", "Conversa não encontrada.", 404, { requestId });
  }

  const { data: unreadMessages, error: messagesError } = await supabase
    .from("messages")
    .select("external_id, metadata")
    .eq("organization_id", authz.org.orgId)
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .is("read_at", null)
    .not("external_id", "is", null);
  if (messagesError) {
    return fail("internal_error", "Erro ao ler as mensagens da conversa.", 500, { requestId });
  }

  // A leitura local é a fonte da verdade da interface e não pode depender da
  // disponibilidade momentânea do transporte externo.
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "fn_mark_conversation_read" as never,
    {
      p_organization_id: authz.org.orgId,
      p_conversation_id: conversationId,
    } as never,
  );
  if (error) {
    return fail("internal_error", "Erro ao salvar a leitura da conversa.", 500, { requestId });
  }

  let receiptSynced = true;
  let receiptWarning: string | null = null;
  if ((unreadMessages ?? []).length > 0) {
    const { data: session, error: sessionError } = await admin
      .from("channel_sessions")
      .select("external_session_name, provider")
      .eq("id", conversation.channel_session_id)
      .eq("organization_id", authz.org.orgId)
      .maybeSingle();

    const client = getEvolutionClient();
    if (sessionError || !session) {
      receiptSynced = false;
      receiptWarning =
        "Conversa marcada como lida no CRM, mas a conexão do WhatsApp não foi encontrada.";
    } else if (session.provider !== "evolution") {
      receiptSynced = false;
      receiptWarning =
        "Conversa marcada como lida no CRM, mas a conexão não usa a Evolution API.";
    } else if (!client) {
      receiptSynced = false;
      receiptWarning =
        "Conversa marcada como lida no CRM, mas a Evolution API não está configurada.";
    }

    const contact = Array.isArray(conversation.contacts)
      ? conversation.contacts[0]
      : conversation.contacts;
    const phone = typeof contact?.phone_number === "string" ? contact.phone_number : "";
    const keys = buildEvolutionReadKeys(unreadMessages ?? [], phone);
    if (receiptSynced && client && session && keys.length > 0) {
      try {
        await client.markMessagesAsRead(session.external_session_name, keys);
      } catch (receiptError) {
        receiptSynced = false;
        receiptWarning =
          "Conversa marcada como lida no CRM, mas o recibo não chegou ao WhatsApp.";
        console.error("[conversation.read] Evolution receipt failed", {
          request_id: requestId,
          conversation_id: conversationId,
          count: keys.length,
          error: receiptError instanceof Error ? receiptError.message : String(receiptError),
        });
      }
    }
  }

  const result = Array.isArray(data) ? data[0] : null;
  return ok(
    {
      marked_messages: Number(record(result).marked_messages ?? 0),
      unread_count: 0,
      receipt_synced: receiptSynced,
      receipt_warning: receiptWarning,
    },
    { requestId },
  );
}
