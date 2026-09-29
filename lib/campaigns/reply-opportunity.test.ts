import { describe, expect, it } from "vitest";
import { decideReplyOpportunityAction } from "./reply-opportunity-decision";

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
