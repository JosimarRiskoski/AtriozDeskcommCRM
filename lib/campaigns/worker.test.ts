import { describe, expect, it } from "vitest";
import { isWithinBusinessHours, renderCampaignText } from "./worker-helpers";
import { advanceCampaign, isAmbiguousCampaignDelivery, isTerminalCampaignRecipientStatus, runCampaignTick } from "./worker";
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

describe("campaign completion", () => {
  it("nao reenvia automaticamente quando o provedor aceitou mas a confirmacao falhou", () => {
    expect(isAmbiguousCampaignDelivery("provider_confirmation_uncertain:timeout")).toBe(true);
    expect(isAmbiguousCampaignDelivery("provider_confirmation_uncertain:evolution_timeout: 15000ms")).toBe(true);
    expect(isAmbiguousCampaignDelivery("campaign_text_checkpoint_failed:timeout")).toBe(false);
  });
  it("preserva destinatario ja concluido quando a finalizacao da campanha falha", () => {
    expect(isTerminalCampaignRecipientStatus("sent")).toBe(true);
    expect(isTerminalCampaignRecipientStatus("replied")).toBe(true);
    expect(isTerminalCampaignRecipientStatus("skipped")).toBe(true);
    expect(isTerminalCampaignRecipientStatus("processing")).toBe(false);
    expect(isTerminalCampaignRecipientStatus("pending")).toBe(false);
  });

  it("nao conclui campanha quando a consulta aos destinatarios falha", async () => {
    let campaignUpdated = false;
    const admin = {
      from: (table: string) => {
        if (table === "outreach_campaign_recipients") {
          return {
            select: () => ({ eq: async () => ({ data: null, error: { message: "statement timeout" } }) }),
          };
        }
        if (table === "outreach_campaigns") {
          return { update: () => { campaignUpdated = true; return { eq: async () => ({ error: null }) }; } };
        }
        throw new Error(`unexpected table: ${table}`);
      },
    } as unknown as SupabaseClient;

    await expect(advanceCampaign(admin, {
      campaign_id: "campaign-1",
      interval_seconds: 300,
    } as Parameters<typeof advanceCampaign>[1], new Date("2026-10-05T20:00:00Z")))
      .rejects.toThrow("campaign_recipient_status_lookup_failed:statement timeout");
    expect(campaignUpdated).toBe(false);
  });
});
