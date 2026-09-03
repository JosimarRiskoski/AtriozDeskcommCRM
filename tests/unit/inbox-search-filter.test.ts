import { describe, expect, it } from "vitest";

import { conversationSearchOrFilter } from "@/lib/inbox/search-filter";

describe("busca do Inbox", () => {
  it("combina texto da mensagem com os contatos localizados", () => {
    expect(
      conversationSearchOrFilter("Carlos", [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ]),
    ).toBe(
      "last_message_preview.ilike.%Carlos%,contact_id.in.(11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222)",
    );
  });

  it("mantém percentuais e sublinhados como texto, não como coringas", () => {
    expect(conversationSearchOrFilter("Plano_50%", [])).toBe(
      "last_message_preview.ilike.%Plano\\_50\\%%",
    );
  });
});
