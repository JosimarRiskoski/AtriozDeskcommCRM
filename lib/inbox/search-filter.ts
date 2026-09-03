/**
 * Filtro da lista do Inbox. Os IDs vêm de uma consulta RLS-scoped de contatos,
 * portanto podem ser usados no operador `in` sem expor ou interpolar entrada.
 */
export function conversationSearchOrFilter(raw: string, contactIds: string[]): string {
  const search = raw
    .trim()
    .replace(/[(),]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[%_]/g, (value) => `\\${value}`)
    .trim();
  const parts = [`last_message_preview.ilike.%${search}%`];
  if (contactIds.length) parts.push(`contact_id.in.(${contactIds.join(",")})`);
  return parts.join(",");
}
