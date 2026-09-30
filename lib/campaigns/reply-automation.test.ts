import { describe, expect, it } from "vitest";

import {
  campaignReplyAudioDestination,
  campaignReplyDueAt,
  shouldAdvanceCampaignLead,
} from "./reply-automation-helpers";
import { isMediaPathOwnedBy } from "@/lib/messaging/media/outbound";

describe("campaign reply automation", () => {
  it("guarda o áudio da continuação na pasta da conversa", () => {
    const destination = campaignReplyAudioDestination({
      organizationId: "org-1",
      conversationId: "conversation-1",
      campaignId: "campaign-1",
      recipientId: "recipient-1",
      sourcePath: "org-1/campaigns/campaign-1/reply-audio.ogg",
    });
    expect(destination).toBe(
      "org-1/conversation-1/campaign-campaign-1-reply-recipient-1-reply-audio.ogg",
    );
    expect(isMediaPathOwnedBy(destination, "org-1", "conversation-1")).toBe(true);
  });

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
