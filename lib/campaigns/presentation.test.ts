import { describe, expect, it } from "vitest";
import { summarizeCampaignRecipients } from "./presentation";

describe("campaign presentation", () => {
  it("calcula progresso com enviados, respostas e falhas", () => {
    expect(summarizeCampaignRecipients(["sent", "replied", "failed", "pending"])).toMatchObject({
      total: 4,
      sent: 1,
      replied: 1,
      failed: 1,
      pending: 1,
      finished: 3,
      progress: 75,
    });
  });

  it("mantém progresso zero quando não há destinatários", () => {
    expect(summarizeCampaignRecipients([]).progress).toBe(0);
  });
});
