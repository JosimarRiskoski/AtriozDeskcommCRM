/**
 * Detecta um pedido inequívoco para interromper mensagens.
 *
 * Palavras como "sair" e "parar" aparecem em conversas comuns. Portanto,
 * comandos curtos podem ser aceitos sozinhos, enquanto frases completas
 * precisam expressar explicitamente a intencao de nao receber mensagens.
 */
export function isExplicitStopRequest(raw: string): boolean {
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ");

  if (!normalized) return false;

  if (/^(stop|unsubscribe|cancelar inscricao)$/.test(normalized)) return true;
  if (/^(parar|sair)(?: por favor)?$/.test(normalized)) return true;

  return [
    /\bnao (?:quero|desejo) mais (?:receber|ter) (?:mensagens|contato)\b/,
    /\bnao (?:me )?(?:mande|envie) mais (?:mensagens|whatsapp|propaganda)\b/,
    /\bpare de (?:me )?(?:mandar|enviar) (?:mensagens|whatsapp|propaganda)\b/,
    /\bquero (?:parar de receber|cancelar) (?:as )?(?:mensagens|comunicacoes)\b/,
    /\bremova (?:meu numero|me) (?:da|de sua) (?:lista|campanha|base)\b/,
    /\b(?:pode )?(?:me )?descadastrar(?: meu numero)?\b/,
  ].some((pattern) => pattern.test(normalized));
}
