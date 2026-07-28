import { describe, expect, it } from "vitest";
import { isWithinBusinessHours, renderCampaignText } from "./worker-helpers";

describe("campaign worker helpers", () => {
  it("renderiza variáveis conhecidas sem inventar nome", () => {
    expect(renderCampaignText("Olá {{primeiro_nome}} ({{nome}}) {{telefone}}", {
      recipient_name: "Maria da Silva",
      phone_normalized: "5547999999999",
    })).toBe("Olá Maria (Maria da Silva) 5547999999999");
  });

  it("respeita horário comercial na timezone da campanha", () => {
    expect(isWithinBusinessHours(new Date("2026-07-27T15:00:00Z"), "America/Sao_Paulo", "08:00", "18:00")).toBe(true);
    expect(isWithinBusinessHours(new Date("2026-07-27T23:00:00Z"), "America/Sao_Paulo", "08:00", "18:00")).toBe(false);
  });
});
