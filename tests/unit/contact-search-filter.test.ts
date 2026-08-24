import { describe, expect, it } from "vitest";

import { contactSearchOrFilter } from "@/lib/contacts/search-filter";

describe("busca de contatos", () => {
  it("procura fragmentos também no display name", () => {
    expect(contactSearchOrFilter("emerson")).toContain("display_name.ilike.%emerson%");
  });

  it("não deixa pontuação do operador quebrar a expressão PostgREST", () => {
    const filter = contactSearchOrFilter("Emerson, (Hegen)");
    expect(filter).toContain("name.ilike.%Emerson Hegen%");
    expect(filter).not.toContain("(Hegen)");
  });
});
