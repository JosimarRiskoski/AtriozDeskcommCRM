const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A origem Inbox é opcional nos dados antigos. Só usa um UUID válido para não
 * transformar metadados arbitrários em uma requisição de notas.
 */
export function linkedConversationId(metadata: Record<string, unknown>): string | null {
  const id = metadata.conversation_id;
  return typeof id === "string" && UUID.test(id) ? id : null;
}
