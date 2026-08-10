import { describe, expect, it } from "vitest";

import { parseChatId } from "@/lib/whatsapp/chat-identity";

describe("parseChatId", () => {
  it("normaliza celular brasileiro legado antes de vincular o contato", () => {
    expect(parseChatId("551188765432@c.us")).toEqual({
      kind: "phone",
      phone: "+5511988765432",
      lid: null,
    });
  });

  it("mantem LID como identidade pendente ate a Evolution resolver o telefone", () => {
    expect(parseChatId("203392655843435@lid")).toEqual({
      kind: "lid",
      phone: null,
      lid: "203392655843435",
    });
  });

  it("nao transforma grupo em contato comercial", () => {
    expect(parseChatId("120363123456@g.us").kind).toBe("group");
  });
});
