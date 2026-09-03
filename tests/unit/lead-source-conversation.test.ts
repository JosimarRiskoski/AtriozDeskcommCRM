import { describe, expect, it } from "vitest";

import { linkedConversationId } from "@/lib/leads/source-conversation";

describe("linkedConversationId", () => {
  it("aceita somente o id de conversa gravado pela criação a partir do Inbox", () => {
    expect(
      linkedConversationId({ conversation_id: "11111111-1111-4111-8111-111111111111" }),
    ).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("ignora valores inválidos de metadados", () => {
    expect(linkedConversationId({ conversation_id: "nao-e-uuid" })).toBeNull();
    expect(linkedConversationId({})).toBeNull();
  });
});
