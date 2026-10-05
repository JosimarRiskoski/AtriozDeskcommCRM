import { describe, expect, it } from "vitest";
import { isWithinBusinessHours, renderCampaignText } from "./worker-helpers";
import { runCampaignTick } from "./worker";
import type { SupabaseClient } from "@supabase/supabase-js";

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

describe("campaign recipient lease", () => {
  it("reserva tempo suficiente para um envio lento sem reclamar o mesmo destinatario", async () => {
    let leaseSeconds = 0;
    const admin = {
      rpc: async (_name: string, args: { p_lease_seconds: number }) => {
        leaseSeconds = args.p_lease_seconds;
        return { data: [], error: null };
      },
    } as unknown as SupabaseClient;

    await runCampaignTick(admin);

    expect(leaseSeconds).toBe(900);
  });
});
