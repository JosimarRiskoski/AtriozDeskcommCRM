import { describe, expect, it } from "vitest";

import { internalNoteFromLead } from "@/components/kanban/LeadFieldsForm";
import type { Lead } from "@/lib/types/leads";

describe("internalNoteFromLead", () => {
  it("recupera a observação criada pelo formulário do Inbox", () => {
    const lead = {
      custom_fields: { internal_note: "Cliente pediu retorno amanhã" },
    } as unknown as Lead;

    expect(internalNoteFromLead(lead)).toBe("Cliente pediu retorno amanhã");
  });

  it("não exibe valores arbitrários como texto", () => {
    const lead = { custom_fields: { internal_note: { privado: true } } } as unknown as Lead;

    expect(internalNoteFromLead(lead)).toBe("");
  });
});
