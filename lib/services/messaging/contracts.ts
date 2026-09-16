/**
 * MESSAGING-owned contracts. IDs are logical references, never foreign keys
 * to CORE. Every message/event carries organization_id for tenant isolation.
 */
export interface ChannelStatusEvent {
  event_id: string;
  organization_id: string;
  channel_session_id: string;
  provider: "evolution" | string;
  status: string;
  occurred_at: string;
  version: string;
}

export interface ConversationSnapshot {
  organization_id: string;
  conversation_id: string;
  contact: {
    contact_id: string;
    display_name: string | null;
    phone_number: string | null;
    is_blocked: boolean;
    version: string;
  };
  channel_session_id: string;
  status: string;
  last_message_at: string | null;
  version: string;
}

export interface MessageEnvelope<TPayload = Record<string, unknown>> {
  event_id: string;
  organization_id: string;
  message_id: string;
  conversation_id: string;
  contact_id: string;
  direction: "inbound" | "outbound";
  status: string;
  idempotency_key: string;
  occurred_at: string;
  payload: TPayload;
}

export interface MessagingCommand<TPayload = Record<string, unknown>> {
  command_id: string;
  organization_id: string;
  command_type: "send_message" | "mark_read" | "sync_channel";
  idempotency_key: string;
  created_at: string;
  payload: TPayload;
}
