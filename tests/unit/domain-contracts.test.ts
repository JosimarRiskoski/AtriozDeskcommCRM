import { describe, expect, it } from "vitest";
import type { CoreOutboxEvent } from "@/lib/services/core/contracts";
import type { MessageEnvelope, MessagingCommand } from "@/lib/services/messaging/contracts";

describe("CORE/MESSAGING boundary contracts", () => {
  it("requires tenant and event identity on integration events", () => {
    const event: CoreOutboxEvent = {
      event_id: "event", organization_id: "org", event_type: "contact.updated",
      schema_version: 1, entity_kind: "contact", entity_id: "contact",
      occurred_at: new Date(0).toISOString(), payload: {},
    };
    expect(event.organization_id).toBe("org");
    expect(event.schema_version).toBe(1);
  });
  it("requires idempotency on message effects and commands", () => {
    const message: MessageEnvelope = {
      event_id: "event", organization_id: "org", message_id: "message",
      conversation_id: "conversation", contact_id: "contact", direction: "outbound",
      status: "queued", idempotency_key: "send-key", occurred_at: new Date(0).toISOString(), payload: {},
    };
    const command: MessagingCommand = {
      command_id: "command", organization_id: "org", command_type: "send_message",
      idempotency_key: "send-key", created_at: new Date(0).toISOString(), payload: {},
    };
    expect(message.idempotency_key).toBe(command.idempotency_key);
  });
});
