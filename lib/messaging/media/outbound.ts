export function isMediaPathOwnedBy(path: string, orgId: string, conversationId: string): boolean {
  return path.startsWith(`${orgId}/${conversationId}/`);
}
