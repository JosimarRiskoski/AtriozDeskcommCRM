import { normalizePhoneBR } from "@/lib/phone/normalize";

export type ChatIdentity =
  | { kind: "phone"; phone: string; lid: null }
  | { kind: "lid"; phone: null; lid: string }
  | { kind: "resolved"; phone: string; lid: string }
  | { kind: "group"; phone: null; lid: null };

/** Converte o identificador do provedor em uma identidade segura para o CRM. */
export function parseChatId(chatId: string): ChatIdentity {
  if (chatId.endsWith("@g.us")) return { kind: "group", phone: null, lid: null };
  if (chatId.endsWith("@lid")) {
    return { kind: "lid", phone: null, lid: chatId.replace(/@.*$/, "") };
  }
  if (chatId.endsWith("@c.us") || chatId.endsWith("@s.whatsapp.net")) {
    const digits = chatId.replace(/@.*$/, "").replace(/^\+/, "");
    const phone = normalizePhoneBR(`+${digits}`);
    return phone ? { kind: "phone", phone, lid: null } : { kind: "group", phone: null, lid: null };
  }
  return { kind: "group", phone: null, lid: null };
}
