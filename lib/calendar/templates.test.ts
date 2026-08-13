import { describe, expect, it } from "vitest";

import { renderReminderTemplate } from "./templates";

describe("renderReminderTemplate", () => {
  it("renderiza lembrete presencial com texto determinístico", () => {
    const result = renderReminderTemplate(
      "Olá {{nome}}. Dia {{data}} às {{hora}}. {{local_ou_link}}",
      {
        contactName: "Maria",
        startsAt: "2026-08-14T17:00:00.000Z",
        timezone: "America/Sao_Paulo",
        location: "Rua Central, 10",
      },
    );
    expect(result).toBe("Olá Maria. Dia 14/08/2026 às 14:00. Local: Rua Central, 10");
  });

  it("prioriza o link do Meet quando existir", () => {
    const result = renderReminderTemplate("{{local_ou_link}}", {
      startsAt: "2026-08-14T17:00:00.000Z",
      timezone: "America/Sao_Paulo",
      location: "Sala 1",
      meetUrl: "https://meet.google.com/abc-defg-hij",
    });
    expect(result).toBe("Acesse: https://meet.google.com/abc-defg-hij");
  });
});
