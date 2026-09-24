import { describe, expect, it } from "vitest";

import {
  campaignReplyDueAt,
  shouldAdvanceCampaignLead,
} from "./reply-automation-helpers";

describe("campaign reply automation", () => {
  it("respeita o atraso configurado", () => {
    expect(campaignReplyDueAt("2026-09-24T18:00:00.000Z", 10).toISOString()).toBe(
      "2026-09-24T18:00:10.000Z",
    );
  });

  it("move somente para frente e dentro do mesmo pipeline", () => {
    expect(
      shouldAdvanceCampaignLead({
        leadPipelineId: "pipeline-1",
        campaignPipelineId: "pipeline-1",
        currentStagePosition: 1000,
        targetStagePosition: 2000,
      }),
    ).toBe(true);
    expect(
      shouldAdvanceCampaignLead({
        leadPipelineId: "pipeline-1",
        campaignPipelineId: "pipeline-1",
        currentStagePosition: 3000,
        targetStagePosition: 2000,
      }),
    ).toBe(false);
    expect(
      shouldAdvanceCampaignLead({
        leadPipelineId: "pipeline-2",
        campaignPipelineId: "pipeline-1",
        currentStagePosition: 1000,
        targetStagePosition: 2000,
      }),
    ).toBe(false);
  });
});
