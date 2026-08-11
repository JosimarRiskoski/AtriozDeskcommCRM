import { describe, expect, it } from "vitest";

import { conversationLeadLink } from "./conversation-link";

describe("conversationLeadLink", () => {
  it("inclui o link_kind obrigatório para o vínculo com a conversa", () => {
    expect(
      conversationLeadLink({
        organizationId: "org-1",
        leadId: "lead-1",
        conversationId: "conversation-1",
        actorUserId: "user-1",
      }),
    ).toEqual({
      organization_id: "org-1",
      lead_id: "lead-1",
      target_kind: "conversation",
      target_id: "conversation-1",
      link_kind: "primary",
      created_by_user_id: "user-1",
    });
  });
});
