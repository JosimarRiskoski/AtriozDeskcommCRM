import { describe, expect, it } from "vitest";

import { compactEvolutionWebhookLog } from "@/lib/evolution/webhook-log";

describe("compactEvolutionWebhookLog", () => {
  it("nunca persiste texto, telefone integral ou base64", () => {
    const envelope = {
      event: "MESSAGES_UPSERT",
      instance: "principal",
      data: {
        key: { id: "msg-1", remoteJid: "5511999991234@s.whatsapp.net", fromMe: false },
        messageTimestamp: 123,
        message: {
          conversation: "texto secreto",
          audioMessage: { base64: "BASE64-SECRETO" },
        },
      },
    };
    const result = compactEvolutionWebhookLog(envelope, JSON.stringify(envelope));
    const stored = `${result.rawBody}${JSON.stringify(result.payloadParsed)}`;
    expect(stored).not.toContain("texto secreto");
    expect(stored).not.toContain("5511999991234");
    expect(stored).not.toContain("BASE64-SECRETO");
    expect(result.payloadParsed).toMatchObject({
      message_id: "msg-1",
      remote_jid_suffix: "1234",
      from_me: false,
      message_type: "conversation",
    });
  });
});
