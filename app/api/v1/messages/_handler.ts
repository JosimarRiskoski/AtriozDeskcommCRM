/**
 * Core handlers para messages (list + send).
 *
 * Reusados por:
 *  - POST /api/v1/messages (sendMessageHandler)
 *  - GET  /api/v1/conversations/[id]/messages (listMessagesHandler)
 *  - MCP tools (S-13.04)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";
import type { Actor, HandlerCtx } from "@/lib/api/handlers/types";
import { audit } from "@/lib/audit";
import type { ListMessagesQuery, SendMessageInput } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Message } from "@/lib/types/messaging";
import {
  evolutionRecipient,
  getEvolutionClient,
  isEvolutionClosedSessionError,
  parseEvolutionMessageId,
} from "@/lib/evolution/client";
import { isMediaPathOwnedBy } from "@/lib/messaging/media/outbound";
import { resolveWhatsAppChatId } from "@/lib/whatsapp/recipient";

type SB = SupabaseClient;

const MSG_COLS =
  "id, organization_id, conversation_id, channel_session_id, contact_id, external_id, type, direction, status, ack, error_code, error_message, body, media_url, media_mime, media_size_bytes, media_storage_path, sent_via, sent_by_user_id, sent_at, delivered_at, read_at, played_at, metadata, created_at";

function actorAuditPayload(actor: Actor): {
  actorUserId: string | null;
  metadataActor: Record<string, unknown>;
} {
  if (actor.type === "user") {
    return { actorUserId: actor.id, metadataActor: { actor_type: "user" } };
  }
  return {
    actorUserId: null,
    metadataActor: {
      actor_type: actor.type,
      actor_id: actor.id,
      ...(actor.type === "ai_agent" && actor.api_token_id
        ? { actor_api_token_id: actor.api_token_id }
        : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

interface MsgCursorPayload {
  sent_at: string;
  id: string;
}

function encodeMsgCursor(p: MsgCursorPayload): string {
  return Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
}
function decodeMsgCursor(raw: string): MsgCursorPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as MsgCursorPayload;
    if (typeof parsed.id !== "string" || typeof parsed.sent_at !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface ListMessagesResult {
  messages: Message[];
  cursor: string | null;
  has_more: boolean;
}

export async function listMessagesHandler(
  supabase: SB,
  ctx: HandlerCtx,
  conversationId: string,
  q: ListMessagesQuery,
): Promise<ListMessagesResult> {
  let query = supabase
    .from("messages")
    .select(MSG_COLS)
    .eq("conversation_id", conversationId)
    .eq("organization_id", ctx.organization_id)
    // A primeira página precisa conter as mensagens mais recentes. Em ordem
    // crescente, uma conversa com mais de 50 mensagens ficava presa no passado
    // e o atendente não via o que acabou de ser enviado ou recebido.
    .order("sent_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(q.limit + 1);

  if (q.cursor) {
    const c = decodeMsgCursor(q.cursor);
    if (!c) {
      throw new ApiError(400, "invalid_cursor", undefined, ctx.requestId, "Cursor inválido.");
    }
    // O cursor segue para o passado: ao pedir mais, carregamos o histórico.
    query = query.or(`sent_at.lt.${c.sent_at},and(sent_at.eq.${c.sent_at},id.lt.${c.id})`);
  }

  const { data, error } = await query;
  if (error) {
    throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  }

  const rows = (data ?? []) as unknown as Message[];
  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;
  const oldest = page[page.length - 1];
  const cursor =
    hasMore && oldest ? encodeMsgCursor({ sent_at: oldest.sent_at, id: oldest.id }) : null;

  // Mantém o contrato da tela e das ferramentas: resposta cronológica.
  return { messages: page.slice().reverse(), cursor, has_more: hasMore };
}

// ---------------------------------------------------------------------------
// send
// ---------------------------------------------------------------------------

function previewFrom(input: {
  body?: string;
  media_url?: string;
  media_storage_path?: string;
  type?: string;
}): string {
  if (input.body) return input.body.slice(0, 280);
  if (input.media_url || input.media_storage_path) return `[${input.type ?? "media"}]`;
  return "";
}

export async function sendMessageHandler(
  supabase: SB,
  ctx: HandlerCtx,
  input: SendMessageInput,
): Promise<Message> {
  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select(
      "id, organization_id, contact_id, channel_session_id, is_group, group_chat_id, contacts:contact_id(phone_number, wa_identity, source_metadata, is_blocked), channel_sessions:channel_session_id(provider, external_session_name, status)",
    )
    .eq("id", input.conversation_id)
    .maybeSingle();

  if (convErr) {
    throw new ApiError(500, "internal_error", undefined, ctx.requestId, convErr.message);
  }
  if (!conv) {
    throw new ApiError(404, "not_found", undefined, ctx.requestId, "Conversa não encontrada.");
  }

  type Joined = {
    id: string;
    organization_id: string;
    contact_id: string;
    channel_session_id: string;
    is_group: boolean;
    group_chat_id: string | null;
    contacts: {
      phone_number: string | null;
      wa_identity: string | null;
      source_metadata: Record<string, unknown> | null;
      is_blocked: boolean;
    } | null;
    channel_sessions: {
      provider: "evolution";
      external_session_name: string | null;
      status: string;
    } | null;
  };
  const c = conv as unknown as Joined;

  if (c.contacts?.is_blocked) {
    throw new ApiError(
      403,
      "forbidden",
      undefined,
      ctx.requestId,
      "Contato bloqueou o atendimento.",
    );
  }

  if (
    input.media_storage_path &&
    !isMediaPathOwnedBy(input.media_storage_path, c.organization_id, c.id)
  ) {
    throw new ApiError(
      422,
      "invalid_media_path",
      undefined,
      ctx.requestId,
      "media_storage_path fora da conversa.",
    );
  }

  const now = new Date().toISOString();
  const insertRow = {
    organization_id: c.organization_id,
    conversation_id: c.id,
    channel_session_id: c.channel_session_id,
    contact_id: c.contact_id,
    type: input.type,
    direction: "outbound" as const,
    status: "queued",
    body: input.body ?? null,
    media_url: input.media_url ?? null,
    media_mime: input.media_mime ?? null,
    media_storage_path: input.media_storage_path ?? null,
    media_size_bytes: input.media_size_bytes ?? null,
    sent_via:
      ctx.actor.type === "user"
        ? ("user" as const)
        : ctx.actor.type === "ai_agent"
          ? ("ai" as const)
          : ("system" as const),
    sent_by_user_id: ctx.actor.type === "user" ? ctx.actor.id : null,
    sent_at: now,
    metadata: {
      ...(input.metadata ?? {}),
      ...(input.interactive_poll ? { interactive_poll: input.interactive_poll } : {}),
      ...(ctx.actor.type === "ai_agent" ? { ai_actor_id: ctx.actor.id } : {}),
    },
  };

  const { data: created, error: insErr } = await supabase
    .from("messages")
    .insert(insertRow)
    .select(MSG_COLS)
    .single();

  if (insErr || !created) {
    throw new ApiError(
      500,
      "internal_error",
      undefined,
      ctx.requestId,
      insErr?.message ?? "insert_failed",
    );
  }
  let message = created as unknown as Message;

  const evolution = getEvolutionClient();
  const provider = c.channel_sessions?.provider;
  const chatId = resolveWhatsAppChatId({
    isGroup: c.is_group,
    groupChatId: c.group_chat_id,
    phoneNumber: c.contacts?.phone_number,
    waIdentity: c.contacts?.wa_identity,
  });

  if (provider !== "evolution" || !evolution) {
    const { data: updated } = await supabase
      .from("messages")
      .update({
        metadata: { ...(message.metadata ?? {}), queued_reason: "evolution_not_configured" },
      })
      .eq("id", message.id)
      .select(MSG_COLS)
      .maybeSingle();
    if (updated) message = updated as unknown as Message;
  } else if (!chatId) {
    const { data: updated } = await supabase
      .from("messages")
      .update({
        status: "failed",
        error_code: "missing_phone_number",
        error_message: "Contato sem telefone para envio WhatsApp.",
      })
      .eq("id", message.id)
      .select(MSG_COLS)
      .maybeSingle();
    if (updated) message = updated as unknown as Message;
  } else if (!c.channel_sessions || c.channel_sessions.status !== "WORKING") {
    const { data: updated } = await supabase
      .from("messages")
      .update({
        metadata: {
          ...(message.metadata ?? {}),
          queued_reason: "channel_session_not_working",
        },
      })
      .eq("id", message.id)
      .select(MSG_COLS)
      .maybeSingle();
    if (updated) message = updated as unknown as Message;
  } else {
    try {
      let providerRes: unknown;
      const instanceName = c.channel_sessions.external_session_name;
      if (!instanceName) throw new Error("evolution_instance_name_missing");
      const target = evolutionRecipient(chatId);
      if (evolution) {
        if (input.media_storage_path) {
          const admin = createAdminClient();
          const { data: signed, error: signErr } = await admin.storage
            .from("whatsapp-media")
            .createSignedUrl(input.media_storage_path, 600);
          if (signErr || !signed?.signedUrl) {
            throw new Error(`storage_sign_failed: ${signErr?.message ?? "no_url"}`);
          }
          const filename = input.media_storage_path.split("/").pop() ?? undefined;
          providerRes = await evolution.sendMedia(instanceName, {
            number: target,
            mediaType:
              input.type === "audio"
                ? "audio"
                : input.type === "video"
                  ? "video"
                  : input.type === "document"
                    ? "document"
                    : "image",
            media: signed.signedUrl,
            mimeType: input.media_mime ?? "application/octet-stream",
            fileName: filename,
            caption: input.body ?? null,
          });
        } else if (input.interactive_poll) {
          providerRes = await evolution.sendPoll(
            instanceName,
            target,
            input.body ?? "Escolha uma opção",
            input.interactive_poll.options,
            input.interactive_poll.multipleAnswers,
          );
        } else {
          providerRes = await evolution.sendText(instanceName, target, input.body ?? "");
        }
      }
      const externalId = parseEvolutionMessageId(providerRes);
      const { data: updated } = await supabase
        .from("messages")
        .update({ status: "sent", external_id: externalId, ack: 0 })
        .eq("id", message.id)
        .select(MSG_COLS)
        .maybeSingle();
      if (updated) message = updated as unknown as Message;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "evolution_unknown";
      const code = msg.startsWith("storage_sign_failed")
        ? "storage_sign_failed"
        : isEvolutionClosedSessionError(msg)
          ? "evolution_connection_closed"
          : "evolution_error";
      console.error("[messages.send] Evolution dispatch failed", {
        request_id: ctx.requestId,
        message_id: message.id,
        conversation_id: c.id,
        channel_session_id: c.channel_session_id,
        error_code: code,
        provider_error: msg.slice(0, 500),
      });
      const { data: updated } = await supabase
        .from("messages")
        .update({
          status: "failed",
          error_code: code,
          error_message: msg,
        })
        .eq("id", message.id)
        .select(MSG_COLS)
        .maybeSingle();
      if (updated) message = updated as unknown as Message;

      if (code === "evolution_connection_closed") {
        const failedAt = new Date().toISOString();
        await supabase
          .from("channel_sessions")
          .update({
            status: "FAILED",
            status_reason:
              "Sessão do WhatsApp encerrada na Evolution. Reconecte por QR Code.",
            last_status_change_at: failedAt,
            last_health_check_at: failedAt,
            consecutive_health_fails: 1,
          })
          .eq("organization_id", c.organization_id)
          .eq("id", c.channel_session_id);
      }
    }
  }

  await supabase
    .from("conversations")
    .update({
      last_outbound_at: now,
      last_message_at: now,
      last_message_preview: previewFrom({
        body: input.body,
        media_url: input.media_url,
        media_storage_path: input.media_storage_path,
        type: input.type,
      }),
    })
    .eq("id", c.id);

  const a = actorAuditPayload(ctx.actor);
  await audit({
    action: "message.sent",
    actorUserId: a.actorUserId,
    organizationId: c.organization_id,
    resourceType: "message",
    resourceId: message.id,
    requestId: ctx.requestId,
    metadata: { ...a.metadataActor, status: message.status, type: message.type },
  });

  await supabase
    .rpc("emit_event", {
      p_event_type: "message.sent",
      p_entity_kind: "message",
      p_entity_id: message.id,
      p_payload: { status: message.status, conversation_id: c.id },
      p_metadata: { request_id: ctx.requestId, ...a.metadataActor },
      p_organization_id: c.organization_id,
    })
    .then(({ error }) => {
      if (error) console.error("[messages.send] emit_event failed", error.message);
    });

  return message;
}
