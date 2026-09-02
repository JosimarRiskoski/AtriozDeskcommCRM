import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

Element.prototype.scrollIntoView = vi.fn();

vi.mock("@/hooks/inbox/useAssignableMembers", () => ({
  useAssignableMembers: () => ({
    data: [{ user_id: "11111111-1111-4111-8111-111111111111", role: "admin", full_name: "Josimar" }],
  }),
}));

import { ManageAppointmentDialog } from "./AgendaClient";

describe("ManageAppointmentDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { id: "appointment-1" } }) }),
    );
  });

  it("permite alterar o responsável e acessar o link do Google Meet", () => {
    render(
      <ManageAppointmentDialog
        appointment={{
          id: "appointment-1",
          contact_id: "contact-1",
          title: "Call das 16h",
          status: "scheduled",
          appointment_type: "online",
          starts_at: "2026-09-01T16:00:00-03:00",
          ends_at: "2026-09-01T17:00:00-03:00",
          location: null,
          meet_url: "https://meet.google.com/abc-defg-hij",
          assigned_user_id: null,
        }}
        onOpenChange={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Responsável")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar link do Meet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir Google Meet" })).toHaveAttribute(
      "href",
      "https://meet.google.com/abc-defg-hij",
    );
  });

  it("envia o novo responsável ao confirmar as alterações", async () => {
    render(
      <ManageAppointmentDialog
        appointment={{
          id: "appointment-1",
          title: "Visita das 17h",
          status: "scheduled",
          appointment_type: "visit",
          starts_at: "2026-09-01T17:00:00-03:00",
          ends_at: "2026-09-01T18:00:00-03:00",
          location: "Cliente",
          meet_url: null,
          assigned_user_id: null,
        }}
        onOpenChange={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("Responsável"));
    fireEvent.click((await screen.findAllByText("Josimar")).at(-1)!);
    fireEvent.click(screen.getByRole("button", { name: "Revisar alterações" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar alterações" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const [, request] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(String(request?.body))).toEqual({
      action: "assign",
      confirmed: true,
      assigned_user_id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("exige uma revisão específica antes de concluir", async () => {
    render(
      <ManageAppointmentDialog
        appointment={{
          id: "appointment-1",
          title: "Visita das 17h",
          status: "scheduled",
          appointment_type: "visit",
          starts_at: "2026-09-01T17:00:00-03:00",
          ends_at: "2026-09-01T18:00:00-03:00",
          location: "Cliente",
          meet_url: null,
          assigned_user_id: null,
        }}
        onOpenChange={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText("Marcar como concluído")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar conclusão" })).toBeDisabled();
  });

  it("oferece reativação para compromisso concluído", () => {
    render(
      <ManageAppointmentDialog
        appointment={{
          id: "appointment-1",
          title: "Visita das 17h",
          status: "completed",
          appointment_type: "visit",
          starts_at: "2026-09-01T17:00:00-03:00",
          ends_at: "2026-09-01T18:00:00-03:00",
          location: "Cliente",
          meet_url: null,
          assigned_user_id: null,
        }}
        onOpenChange={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Reativar compromisso" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Concluir" })).not.toBeInTheDocument();
  });
});
