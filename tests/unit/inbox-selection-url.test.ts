import { describe, expect, it } from "vitest";

import { inboxSelectionHref } from "@/lib/inbox/selection-url";

describe("persistência da conversa aberta no Inbox", () => {
  it("preserva o filtro e grava a conversa escolhida na URL", () => {
    expect(
      inboxSelectionHref("/app/inbox", new URLSearchParams("filter=all"), "conversation-1"),
    ).toBe("/app/inbox?filter=all&id=conversation-1");
  });

  it("remove somente a conversa quando o operador fecha a seleção", () => {
    expect(
      inboxSelectionHref(
        "/app/inbox",
        new URLSearchParams("filter=mine&id=conversation-1"),
        null,
      ),
    ).toBe("/app/inbox?filter=mine");
  });
});
