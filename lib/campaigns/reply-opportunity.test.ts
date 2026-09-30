import { describe, expect, it } from "vitest";
import { campaignReplyLeadTitle, decideReplyOpportunityAction } from "./reply-opportunity-decision";

describe("decideReplyOpportunityAction", () => {
  it("cria o primeiro card quando o contato ainda nao tem oportunidade aberta", () => {
    expect(decideReplyOpportunityAction({ activeLead: null, targetPipelineId: "pipeline-a" })).toBe(
      "create",
    );
  });

  it("move o card aberto quando ele pertence ao funil configurado", () => {
    expect(
      decideReplyOpportunityAction({
        activeLead: { pipeline_id: "pipeline-a" },
        targetPipelineId: "pipeline-a",
      }),
    ).toBe("move");
  });

  it("nao move card entre funis", () => {
    expect(
      decideReplyOpportunityAction({
        activeLead: { pipeline_id: "pipeline-antigo" },
        targetPipelineId: "pipeline-da-campanha",
      }),
    ).toBe("link_only");
  });
});

describe("campaignReplyLeadTitle", () => {
  it("identifica o contato pelo nome e telefone, nunca pelo nome da campanha", () => {
    expect(campaignReplyLeadTitle({ name: "Debora", display_name: null, phone_number: "+5547988976484" }))
      .toBe("Debora · +5547988976484");
  });

  it("usa telefone quando o contato ainda nao tem nome", () => {
    expect(campaignReplyLeadTitle({ name: null, display_name: null, phone_number: "+5547999999999" }))
      .toBe("+5547999999999");
  });
});
