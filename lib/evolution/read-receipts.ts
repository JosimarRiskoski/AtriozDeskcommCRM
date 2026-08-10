import type { EvolutionMessageKey } from "@/lib/evolution/client";

export interface UnreadMessageRef {
  external_id: string | null;
  metadata: unknown;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function buildEvolutionReadKeys(
  messages: UnreadMessageRef[],
  phoneNumber: string,
): EvolutionMessageKey[] {
  const digits = phoneNumber.replace(/\D/g, "");
  const defaultRemoteJid = digits ? `${digits}@s.whatsapp.net` : "";
  return messages.flatMap((message) => {
    if (!message.external_id) return [];
    const evolutionMessage = record(record(message.metadata).evolution_message);
    const key = record(evolutionMessage.key);
    const remoteJid =
      typeof key.remoteJid === "string" && key.remoteJid ? key.remoteJid : defaultRemoteJid;
    if (!remoteJid) return [];
    return [{ id: message.external_id, fromMe: false, remoteJid }];
  });
}
