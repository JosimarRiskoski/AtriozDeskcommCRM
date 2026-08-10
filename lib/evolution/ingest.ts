/**
 * Traduz eventos da Evolution API v2 para o pipeline comercial já consolidado
 * do CRM. Assim contatos, conversas, LGPD, campanhas, handoff e IA continuam
 * com a mesma regra, independentemente do transporte WhatsApp.
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  dispatchCommercialEvent,
  type CommercialEventEnvelope,
  type CommercialMessagePayload,
} from "@/lib/evolution/commercial-ingest";

import { resolveEvolutionRemoteJid } from "./message-identity";
import { ackFromEvolutionUpdate } from "./receipts";
export { ackFromEvolutionUpdate } from "./receipts";

type Admin = ReturnType<typeof createAdminClient>;
type Json = Record<string, unknown>;

export type EvolutionWebhookEnvelope = {
  event?: string;
  instance?: string;
  instanceName?: string;
  data?: Json | Json[];
};

export type EvolutionSession = {
  id: string;
  organization_id: string;
  external_session_name: string;
  is_warmup_complete: boolean | null;
  warmup_started_at: string | null;
  provider?: "evolution";
};

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function messageData(value: unknown): Json {
  const data = object(value);
  return object(data.message);
}

function timestampSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value))
    return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
  if (typeof value === "string" && /^\d+$/.test(value)) return timestampSeconds(Number(value));
  return undefined;
}

function evolutionMessageForRecovery(data: Json): Json {
  const rawMessage = messageData(data);
  const message = Object.fromEntries(
    Object.entries(rawMessage).filter(([key]) => key.toLowerCase() !== "base64"),
  );
  return {
    key: object(data.key),
    message,
    messageTimestamp: data.messageTimestamp,
  };
}

function mediaFromMessage(message: Json): {
  type: string;
  body?: string;
  mediaUrl?: string;
  mime?: string;
  pollVote?: boolean;
} {
  const text = string(message.conversation) ?? string(object(message.extendedTextMessage).text);
  if (text) return { type: "chat", body: text };

  const selectedOptions = object(object(message.pollUpdateMessage).vote).selectedOptions;
  if (Array.isArray(selectedOptions)) {
    const names = selectedOptions.filter(
      (option): option is string => typeof option === "string" && Boolean(option.trim()),
    );
    if (names.length > 0) {
      return { type: "chat", body: `Resposta de enquete: ${names.join(", ")}`, pollVote: true };
    }
  }

  // A Evolution anexa o binário baixado em `message.base64` (no nível da
  // mensagem), não dentro de `imageMessage`/`audioMessage`.
  const downloadedBase64 = string(message.base64);
  const downloadedUrl = string(message.mediaUrl);

  const candidates: Array<[string, Json]> = [
    ["image", object(message.imageMessage)],
    ["video", object(message.videoMessage)],
    ["document", object(message.documentMessage)],
    ["audio", object(message.audioMessage)],
    ["sticker", object(message.stickerMessage)],
  ];
  for (const [type, item] of candidates) {
    if (Object.keys(item).length === 0) continue;
    const mime = string(item.mimetype);
    const base64 = downloadedBase64 ?? string(item.base64) ?? string(item.media);
    const url = downloadedUrl ?? string(item.url);
    const mediaUrl = base64
      ? base64.startsWith("data:")
        ? base64
        : `data:${mime ?? "application/octet-stream"};base64,${base64}`
      : url;
    return {
      type,
      body: string(item.caption) ?? string(item.fileName),
      mediaUrl,
      mime,
    };
  }
  return { type: "chat" };
}

/**
 * A Evolution/Baileys pode entregar a mesma conversa com um LID em
 * `remoteJid` e o telefone canônico em `remoteJidAlt`. O LID não é roteável
 * pelo CRM como telefone e, se o ignorarmos, a mensagem fica pendente mesmo
 * quando já existe um contato com o número correto.
 */
export function normalizeEvolutionMessage(data: Json): CommercialMessagePayload | null {
  const key = object(data.key);
  const id = string(key.id) ?? string(data.id);
  const fromMe = key.fromMe === true;
  const rawRemoteJid = string(key.remoteJid) ?? string(data.remoteJid);
  const remoteJidAlt = string(key.remoteJidAlt) ?? string(data.remoteJidAlt);
  const identity = resolveEvolutionRemoteJid({ remoteJid: rawRemoteJid, remoteJidAlt });
  const remoteJid = identity.remoteJid;
  if (!id || !remoteJid || remoteJid === "status@broadcast") return null;
  const parsed = mediaFromMessage(messageData(data));
  return {
    provider: "evolution",
    id,
    fromMe,
    from: remoteJid,
    to: fromMe ? remoteJid : undefined,
    body: parsed.body,
    type: parsed.type,
    hasMedia: Boolean(parsed.mediaUrl),
    timestamp: timestampSeconds(data.messageTimestamp),
    mediaUrl: parsed.mediaUrl,
    mimetype: parsed.mime,
    _data: {
      // Em mensagens `fromMe`, a Evolution/Baileys informa no `pushName` o
      // nome da conta conectada (o operador), e nao o nome do destinatario.
      // Reaproveitar esse valor no upsert faria contatos reais herdarem o nome
      // do proprio usuario durante a sincronizacao do historico.
      pushName: fromMe ? undefined : string(data.pushName),
      message: messageData(data),
      evolution_message: evolutionMessageForRecovery(data),
      // Mantemos a identidade original somente para auditoria/depuração. O
      // pipeline usa `from` já resolvido para não criar contato duplicado.
      ...(identity.usedAlternatePhone
        ? { original_remote_jid: rawRemoteJid, remote_jid_alt: remoteJidAlt ?? null }
        : {}),
      ...(parsed.pollVote ? { poll_vote: true } : {}),
    },
  };
}

function statusFromEvolution(data: Json): string {
  const raw = String(data.state ?? data.status ?? object(data.instance).state ?? "").toLowerCase();
  if (raw === "open" || raw === "connected" || raw === "working") return "WORKING";
  if (raw.includes("qr") || raw.includes("pair")) return "SCAN_QR_CODE";
  if (raw.includes("connect") || raw.includes("start")) return "STARTING";
  if (raw.includes("fail") || raw.includes("error")) return "FAILED";
  return "STOPPED";
}

/** Processa cada evento da Evolution com a mesma idempotência do Inbox atual. */
export async function dispatchEvolutionEvent(
  admin: Admin,
  session: EvolutionSession,
  envelope: EvolutionWebhookEnvelope,
  requestId: string,
): Promise<{ inbound: boolean; outbound: boolean }> {
  const event = String(envelope.event ?? "")
    .toUpperCase()
    .replace(/[.-]/g, "_");
  const values = Array.isArray(envelope.data) ? envelope.data : [object(envelope.data)];
  let inbound = false;
  let outbound = false;

  for (const data of values) {
    // `MESSAGES_SET` é usado pela Evolution ao sincronizar mensagens já
    // existentes após a conexão; precisa passar pelo mesmo caminho idempotente
    // para não deixar o Inbox desatualizado.
    if (event === "MESSAGES_UPSERT" || event === "MESSAGES_SET") {
      const payload = normalizeEvolutionMessage(data);
      if (!payload) continue;
      inbound ||= !payload.fromMe;
      outbound ||= Boolean(payload.fromMe);
      const mapped: CommercialEventEnvelope = {
        event: "message.any",
        session: session.external_session_name,
        payload,
      };
      await dispatchCommercialEvent(admin, { ...session, provider: "evolution" }, mapped, requestId);
      continue;
    }

    if (event === "MESSAGES_UPDATE" || event === "SEND_MESSAGE_UPDATE") {
      const key = object(data.key);
      const id = string(key.id) ?? string(data.id);
      if (!id) continue;
      await dispatchCommercialEvent(
        admin,
        { ...session, provider: "evolution" },
        {
          event: "message.ack",
          session: session.external_session_name,
          payload: { provider: "evolution", id, ack: ackFromEvolutionUpdate(data) },
        },
        requestId,
      );
      continue;
    }

    if (event === "CONNECTION_UPDATE") {
      await dispatchCommercialEvent(
        admin,
        { ...session, provider: "evolution" },
        {
          event: "session.status",
          session: session.external_session_name,
          payload: { provider: "evolution", status: statusFromEvolution(data) },
        },
        requestId,
      );
    }
  }

  const now = new Date().toISOString();
  if (inbound || outbound) {
    await admin
      .from("channel_sessions")
      .update({
        ...(inbound ? { last_inbound_event_at: now } : {}),
        ...(outbound ? { last_outbound_event_at: now } : {}),
      })
      .eq("id", session.id);
  }
  return { inbound, outbound };
}
