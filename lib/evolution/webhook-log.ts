import type { EvolutionWebhookEnvelope } from "@/lib/evolution/ingest";

const MAX_FULL_PAYLOAD_BYTES = 64 * 1024;

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
  const rawBytes = Buffer.byteLength(rawBody, "utf8");
  const summary: JsonObject = {
    compacted: rawBytes > MAX_FULL_PAYLOAD_BYTES,
    original_size_bytes: rawBytes,
    event: String(envelope.event ?? "unknown"),
    instance: String(envelope.instance ?? envelope.instanceName ?? ""),
    data_count: data.filter((item) => item !== undefined && item !== null).length,
    message_id:
      typeof key.id === "string"
        ? key.id
        : typeof first.id === "string"
          ? first.id
          : null,
    remote_jid: typeof key.remoteJid === "string" ? key.remoteJid : null,
  };

  if (rawBytes <= MAX_FULL_PAYLOAD_BYTES) {
    return {
      // raw_body é obrigatório no schema. Guardamos o resumo nele e o JSON
      // completo somente uma vez, em payload_parsed.
      rawBody: JSON.stringify(summary),
      payloadParsed: envelope as unknown as JsonObject,
    };
  }

  // Eventos grandes (principalmente MESSAGES_SET e mídia base64) não podem
  // consumir centenas de MB no banco apenas para observabilidade.
  return {
    rawBody: JSON.stringify(summary),
    payloadParsed: summary,
  };
}

