/**
 * Consome `media.persist_requested`: baixa o binário pela Evolution API e
 * persiste no bucket privado `whatsapp-media`, preenchendo
 * media_storage_path/media_size_bytes na linha de `messages`.
 * Retry/backoff é responsabilidade do drain (`lib/event-log/drain.ts`), não
 * deste handler: aqui só retornamos `status:"error"` em falha. O drain conta
 * `attempts` e dead-letra a partir do próprio `MAX_ATTEMPTS`; espelhamos esse
 * valor localmente (`DRAIN_MAX_ATTEMPTS`) só para saber quando é a ÚLTIMA
 * tentativa que o drain vai permitir e marcar `metadata.media_status =
 * "failed"` na própria mensagem antes do dead-letter (Onda 3 poderá
 * reprocessar).
 */
import type { EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { storagePathFor } from "@/lib/messaging/media/types";
import { fetchEvolutionMessageMedia } from "@/lib/messaging/media/evolution-api-source";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const MEDIA_PERSIST_CONSUMER_KEY = "media_persist_v1";
// Espelha MAX_ATTEMPTS de lib/event-log/drain.ts (não exportado de lá).
// `row.attempts` chega ao handler como a contagem ANTES do incremento do
// drain; o drain dead-letra quando `row.attempts + 1 >= DRAIN_MAX_ATTEMPTS`,
// ou seja, a última tentativa que o drain ainda vai permitir é
// `row.attempts === DRAIN_MAX_ATTEMPTS - 1`.
const DRAIN_MAX_ATTEMPTS = 5;

interface MessageMediaRow {
  id: string;
  organization_id: string;
  conversation_id: string;
  media_url: string | null;
  media_mime: string | null;
  media_storage_path: string | null;
  channel_session_id: string;
  metadata: Record<string, unknown> | null;
}

export async function persistMessageMedia(row: EventRow): Promise<HandlerResult> {
  const consumer_key = MEDIA_PERSIST_CONSUMER_KEY;
  const messageId = (row.payload.message_id as string | undefined) ?? row.entity_id;
  if (!messageId) return { consumer_key, status: "skipped", detail: "no message_id" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("messages")
    .select(
      "id, organization_id, conversation_id, channel_session_id, media_url, media_mime, media_storage_path, metadata",
    )
    .eq("id", messageId)
    .eq("organization_id", row.organization_id)
    .maybeSingle();
  if (error) return { consumer_key, status: "error", detail: error.message };

  const msg = data as MessageMediaRow | null;
  if (!msg) return { consumer_key, status: "skipped", detail: "message_not_found" };
  if (msg.media_storage_path) return { consumer_key, status: "skipped", detail: "already stored" };

  const markStatus = async (
    media_status: "stored" | "failed",
    patch: Record<string, unknown> = {},
  ) => {
    const nextMetadata: Record<string, unknown> = { ...(msg.metadata ?? {}), media_status };
    if (media_status === "stored") {
      // Depois do upload, o objeto privado e a fonte da verdade. Manter a
      // mensagem crua da Evolution (e o base64 em media_url) faria cada UPDATE
      // e cada leitura do Inbox retransmitir megabytes sem necessidade.
      delete nextMetadata.evolution_message;
    }
    const { error: updErr } = await admin
      .from("messages")
      .update({ metadata: nextMetadata, ...patch })
      .eq("id", msg.id)
      .eq("organization_id", msg.organization_id);
    if (updErr) throw new Error(`message update failed: ${updErr.message}`);
  };

  const isLastAttempt = row.attempts >= DRAIN_MAX_ATTEMPTS - 1;

  const { data: session, error: sessionError } = await admin
    .from("channel_sessions")
    .select("provider, external_session_name")
    .eq("id", msg.channel_session_id)
    .eq("organization_id", msg.organization_id)
    .maybeSingle();
  if (sessionError || !session) {
    return { consumer_key, status: "error", detail: "evolution_session_not_found" };
  }
  if (session.provider !== "evolution") {
    return { consumer_key, status: "error", detail: "unsupported_whatsapp_provider" };
  }
  if (!session.external_session_name) {
    return { consumer_key, status: "error", detail: "evolution_instance_name_missing" };
  }
  const evolutionMessage = msg.metadata?.evolution_message;
  const rawMessage =
    evolutionMessage && typeof evolutionMessage === "object" && !Array.isArray(evolutionMessage)
      ? (evolutionMessage as Record<string, unknown>)
      : {};
  if (!msg.media_url && !Object.keys(rawMessage).length) {
    return { consumer_key, status: "skipped", detail: "media_source_missing" };
  }

  let media;
  try {
    media = await fetchEvolutionMessageMedia({
      mediaUrl: msg.media_url,
      hintMime: msg.media_mime,
      instanceName: session.external_session_name,
      message: rawMessage,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (isLastAttempt) {
      logger.error("[media-persist] download failed permanently", { message_id: msg.id, detail });
      await markStatus("failed");
    }
    return { consumer_key, status: "error", detail };
  }

  const path = storagePathFor(msg.organization_id, msg.conversation_id, msg.id, media.mime);
  const { error: uploadErr } = await admin.storage
    .from("whatsapp-media")
    .upload(path, media.buffer, { contentType: media.mime, upsert: true });
  if (uploadErr) {
    if (isLastAttempt) {
      logger.error("[media-persist] upload failed permanently", {
        message_id: msg.id,
        detail: uploadErr.message,
      });
      await markStatus("failed");
    }
    return { consumer_key, status: "error", detail: uploadErr.message };
  }

  await markStatus("stored", {
    media_url: null,
    media_storage_path: path,
    media_size_bytes: media.buffer.byteLength,
    media_mime: media.mime,
  });

  // Dispara a derivação textual (Onda 3) — fire-and-forget, mesmo padrão do
  // resto do repo: falha de emit não reverte a persistência já concluída.
  const { error: emitErr } = await admin.rpc(
    "emit_event" as never,
    {
      p_event_type: "media.derive_requested",
      p_entity_kind: "message",
      p_entity_id: msg.id,
      p_payload: { message_id: msg.id },
      p_metadata: { source: "media_persist" },
      p_organization_id: msg.organization_id,
    } as never,
  );
  if (emitErr)
    logger.warn("[media-persist] emit_event failed (non-blocking)", {
      message_id: msg.id,
      detail: emitErr.message,
    });

  return { consumer_key, status: "ok" };
}
