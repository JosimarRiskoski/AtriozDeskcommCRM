import { describe, expect, it } from "vitest";

import { googleEventToAppointment } from "./sync";

const integration = {
  organizationId: "00000000-0000-0000-0000-000000000001",
  integrationId: "00000000-0000-0000-0000-000000000002",
  calendarId: "primary",
  timezone: "America/Sao_Paulo",
};

describe("googleEventToAppointment", () => {
  it("converte evento externo sem inventar contato", () => {
    const row = googleEventToAppointment(
      {
        id: "google-1",
        summary: "Reunião externa",
        start: { dateTime: "2026-08-29T14:00:00-03:00" },
        end: { dateTime: "2026-08-29T15:00:00-03:00" },
      },
      integration,
    );
    expect(row).toMatchObject({
      external_event_id: "google-1",
      title: "Reunião externa",
      status: "scheduled",
    });
    expect(row).not.toHaveProperty("contact_id");
  });

  it("aceita evento de dia inteiro", () => {
    const row = googleEventToAppointment(
      {
        id: "google-all-day",
        start: { date: "2026-08-29" },
        end: { date: "2026-08-30" },
      },
      integration,
    );
    expect(row?.metadata).toMatchObject({ google_all_day: true, imported_from_google: true });
    expect(row?.ends_at).not.toBe(row?.starts_at);
  });
});
