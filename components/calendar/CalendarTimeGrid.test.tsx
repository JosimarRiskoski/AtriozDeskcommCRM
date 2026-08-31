import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CalendarTimeGrid } from "./CalendarTimeGrid";
import type { CalendarAppointment } from "@/lib/calendar/types";

const day = new Date("2026-09-01T12:00:00-03:00");
const appointment: CalendarAppointment = {
  id: "appointment-1",
  contact_id: "contact-1",
  title: "Visita técnica",
  status: "scheduled",
  appointment_type: "visit",
  starts_at: "2026-09-01T09:00:00-03:00",
  ends_at: "2026-09-01T10:00:00-03:00",
  location: "Cliente",
  meet_url: null,
  assigned_user_id: null,
};

describe("CalendarTimeGrid", () => {
  it("opens creation at the exact half-hour slot", () => {
    const onCreate = vi.fn();
    render(
      <CalendarTimeGrid
        days={[day]}
        appointments={[]}
        onCreate={onCreate}
        onSelect={vi.fn()}
        onRequestReschedule={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Agendar em 01/09 às 09:30" }));
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onCreate.mock.calls[0]?.[0]).toBeInstanceOf(Date);
  });

  it("keeps CRM appointments draggable and Google-only occupations locked", () => {
    const external: CalendarAppointment = {
      ...appointment,
      id: "google-only",
      contact_id: null,
      title: "Evento externo",
      metadata: { imported_from_google: true },
    };
    render(
      <CalendarTimeGrid
        days={[day]}
        appointments={[appointment, external]}
        onCreate={vi.fn()}
        onSelect={vi.fn()}
        onRequestReschedule={vi.fn()}
      />,
    );
    expect(screen.getByTitle("Arraste para remarcar")).toHaveAttribute("draggable", "true");
    expect(screen.getByTitle("Ocupação importada do Google Agenda")).toHaveAttribute("draggable", "false");
  });
});
