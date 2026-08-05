/**
 * Traduz eventos da Evolution API v2 para o pipeline comercial já consolidado
 * do CRM. Assim contatos, conversas, LGPD, campanhas, handoff e IA continuam
 * com a mesma regra, independentemente do transporte WhatsApp.
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import { dispatchWahaEvent, type WahaEnvelope, type WahaPayload } from "@/lib/waha/ingest";

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
  waha_session_name: string;
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

function mediaFromMessage(message: Json): {
  type: string;
  body?: string;
  mediaUrl?: string;
  mime?: string;
} {
  const text = string(message.conversation) ?? string(object(message.extendedTextMessage).text);
  if (text) return { type: "chat", body: text };

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
    const base64 = string(item.base64) ?? string(item.media);
    const url = string(item.url);
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

function normalizeMessage(data: Json): WahaPayload | null {
  const key = object(data.key);
  const id = string(key.id) ?? string(data.id);
  const fromMe = key.fromMe === true;
  const remoteJid = string(key.remoteJid) ?? string(data.remoteJid);
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
      pushName: string(data.pushName),
      message: messageData(data),
    },
  };
}

function ackFromUpdate(data: Json): number {
  const update = object(data.update);
  const status = update.status ?? data.status;
  if (typeof status === "number") return Math.max(0, Math.min(3, status - 1));
  const normalized = String(status ?? "").toLowerCase();
  if (/read/.test(normalized)) return 3;
  if (/deliver/.test(normalized)) return 2;
  if (/server|sent|ack/.test(normalized)) return 1;
  return 0;
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
    if (event === "MESSAGES_UPSERT") {
      const payload = normalizeMessage(data);
      if (!payload) continue;
      inbound ||= !payload.fromMe;
      outbound ||= Boolean(payload.fromMe);
      const mapped: WahaEnvelope = {
        event: "message.any",
        session: session.external_session_name,
        payload,
      };
      await dispatchWahaEvent(admin, { ...session, provider: "evolution" }, mapped, requestId);
      continue;
    }

    if (event === "MESSAGES_UPDATE" || event === "SEND_MESSAGE_UPDATE") {
      const key = object(data.key);
      const id = string(key.id) ?? string(data.id);
      if (!id) continue;
      await dispatchWahaEvent(
        admin,
        { ...session, provider: "evolution" },
        {
          event: "message.ack",
          session: session.external_session_name,
          payload: { provider: "evolution", id, ack: ackFromUpdate(data) },
        },
        requestId,
      );
      continue;
    }

    if (event === "CONNECTION_UPDATE") {
      await dispatchWahaEvent(
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
