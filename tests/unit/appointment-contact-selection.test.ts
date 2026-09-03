import { describe, expect, it } from "vitest";

import { shouldClearAppointmentContact } from "@/lib/calendar/contact-selection";

describe("seleção de contato do agendamento", () => {
  it("limpa a seleção ao apagar a busca de um contato livre", () => {
    expect(shouldClearAppointmentContact("   ", null)).toBe(true);
  });

  it("não limpa o contato pré-vinculado por Inbox ou Kanban", () => {
    expect(shouldClearAppointmentContact("", "11111111-1111-4111-8111-111111111111")).toBe(false);
  });
});
