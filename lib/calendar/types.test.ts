import { describe, expect, it } from "vitest";

import { appointmentContactName, type CalendarAppointment } from "./types";

const base: CalendarAppointment = {
  id: "appointment-1",
  title: "Visita",
  status: "scheduled",
  appointment_type: "visit",
  starts_at: "2026-08-17T12:00:00.000Z",
  ends_at: "2026-08-17T13:00:00.000Z",
  location: null,
  meet_url: null,
  assigned_user_id: null,
};

describe("agenda", () => {
  it("prioriza o nome cadastrado do contato", () => {
    expect(
      appointmentContactName({
        ...base,
        contacts: { name: "Maria", display_name: "Maria WhatsApp", phone_number: "+5547999999999" },
      }),
    ).toBe("Maria");
  });

  it("usa telefone quando o contato ainda nao tem nome", () => {
    expect(
      appointmentContactName({
        ...base,
        contacts: { name: null, display_name: null, phone_number: "+5547999999999" },
      }),
    ).toBe("+5547999999999");
  });

  it("identifica evento importado sem contato", () => {
    expect(appointmentContactName({ ...base, contacts: null })).toBe("Evento externo do Google");
  });
});
