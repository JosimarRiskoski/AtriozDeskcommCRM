export interface ConversationLeadLinkInput {
  organizationId: string;
  leadId: string;
  conversationId: string;
  actorUserId?: string | null;
}

/** Payload canônico do vínculo que torna a oportunidade localizável pelo Inbox. */
export function conversationLeadLink(input: ConversationLeadLinkInput) {
  return {
    organization_id: input.organizationId,
    lead_id: input.leadId,
    target_kind: "conversation" as const,
    target_id: input.conversationId,
    link_kind: "primary" as const,
    created_by_user_id: input.actorUserId ?? null,
  };
}
