/**
 * Resolve a identidade de uma mensagem recebida da Evolution/Baileys.
 *
 * Mensagens recentes podem vir com o identificador privado `@lid` no campo
 * principal, acompanhado do telefone canônico em `remoteJidAlt`. O CRM só
 * consegue localizar contato e conversa usando o JID de telefone.
 */
export function resolveEvolutionRemoteJid(input: { remoteJid?: string; remoteJidAlt?: string }): {
  remoteJid?: string;
  usedAlternatePhone: boolean;
} {
  const rawRemoteJid = input.remoteJid?.trim() || undefined;
  const remoteJidAlt = input.remoteJidAlt?.trim() || undefined;
  const usedAlternatePhone = Boolean(rawRemoteJid?.endsWith("@lid") && remoteJidAlt);

  return {
    remoteJid: usedAlternatePhone ? remoteJidAlt : rawRemoteJid,
    usedAlternatePhone,
  };
}
