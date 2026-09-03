import type { EvolutionWebhookEnvelope } from "@/lib/evolution/ingest";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function eventData(envelope: EvolutionWebhookEnvelope): unknown[] {
  return Array.isArray(envelope.data) ? envelope.data : [envelope.data];
}

/**
 * Mantém o log técnico útil sem duplicar no Postgres sincronizações inteiras do
 * WhatsApp e mídias em base64. O conteúdo da conversa continua persistido nas
 * tabelas de mensagens/mídia; este log guarda apenas diagnóstico e idempotência.
 */
export function compactEvolutionWebhookLog(
  envelope: EvolutionWebhookEnvelope,
  rawBody: string,
): { rawBody: string; payloadParsed: JsonObject } {
  const data = eventData(envelope);
  const first = asObject(data[0]);
  const key = asObject(first.key);
  const update = asObject(first.update);
  const message = asObject(first.message);
  const rawBytes = Buffer.byteLength(rawBody, "utf8");
  const remoteJid = typeof key.remoteJid === "string" ? key.remoteJid : "";
  const remoteDigits = remoteJid.replace(/\D/g, "");
  const summary: JsonObject = {
    compacted: true,
    original_size_bytes: rawBytes,
    event: String(envelope.event ?? "unknown"),
    instance: String(envelope.instance ?? envelope.instanceName ?? ""),
    data_count: data.filter((item) => item !== undefined && item !== null).length,
    message_id:
      typeof key.id === "string"
        ? key.id
        : typeof first.id === "string"
          ? first.id
          : typeof first.keyId === "string"
            ? first.keyId
          : null,
    remote_jid_suffix: remoteDigits ? remoteDigits.slice(-4) : null,
    from_me:
      typeof key.fromMe === "boolean"
        ? key.fromMe
        : typeof first.fromMe === "boolean"
          ? first.fromMe
          : null,
    message_type: Object.keys(message)[0] ?? null,
    status: update.status ?? first.status ?? null,
    timestamp: first.messageTimestamp ?? first.timestamp ?? null,
  };
  return {
    rawBody: JSON.stringify(summary),
    payloadParsed: summary,
  };
}
