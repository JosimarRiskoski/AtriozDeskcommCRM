/**
 * CORE-owned identities and commercial references.
 * These contracts deliberately contain no Supabase client or database types;
 * the future MESSAGING project will receive only these logical references.
 */
export interface OrganizationContext {
  organization_id: string;
  actor_user_id: string | null;
  authorization_version: string;
}

export interface ContactReference {
  organization_id: string;
  contact_id: string;
  display_name: string | null;
  phone_number: string | null;
  is_blocked: boolean;
  version: string;
}

export interface ConversationAuthorization {
  organization_id: string;
  conversation_id: string;
  contact_id: string;
  can_read: boolean;
  can_send: boolean;
  version: string;
}

export interface CoreOutboxEvent<TPayload = Record<string, unknown>> {
  event_id: string;
  organization_id: string;
  event_type: string;
  schema_version: 1;
  entity_kind: string;
  entity_id: string;
  occurred_at: string;
  payload: TPayload;
}
