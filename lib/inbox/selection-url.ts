/** Mantém a conversa aberta compartilhável e persistente após atualizar o Inbox. */
export function inboxSelectionHref(
  pathname: string,
  current: URLSearchParams,
  conversationId: string | null,
): string {
  const next = new URLSearchParams(current);
  if (conversationId) next.set("id", conversationId);
  else next.delete("id");
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}
