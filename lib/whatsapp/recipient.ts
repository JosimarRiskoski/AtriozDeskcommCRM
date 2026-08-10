export interface ResolveWhatsAppChatIdInput {
  isGroup: boolean;
  groupChatId: string | null;
  phoneNumber: string | null | undefined;
  waIdentity: string | null | undefined;
  verifiedChatId?: string | null | undefined;
}

export function resolveWhatsAppChatId(input: ResolveWhatsAppChatIdInput): string | null {
  if (input.isGroup && input.groupChatId) return input.groupChatId;
  if (input.verifiedChatId && /@(c\.us|s\.whatsapp\.net|lid)$/.test(input.verifiedChatId)) {
    return input.verifiedChatId;
  }
  if (input.phoneNumber) return `${input.phoneNumber.replace(/\D/g, "")}@s.whatsapp.net`;
  if (input.waIdentity?.startsWith("lid:")) return `${input.waIdentity.slice(4)}@lid`;
  return null;
}
