import { describe, expect, it } from "vitest";

import { compactEvolutionWebhookLog } from "@/lib/evolution/webhook-log";

describe("compactEvolutionWebhookLog", () => {
  it("evita duplicar payload pequeno entre raw_body e payload_parsed", () => {
    const envelope = {
      event: "MESSAGES_UPSERT",
      instance: "evo_teste",
      data: { key: { id: "msg-1", remoteJid: "5511999999999@s.whatsapp.net" } },
    };
    const raw = JSON.stringify(envelope);

    const result = compactEvolutionWebhookLog(envelope, raw);

    expect(result.payloadParsed).toMatchObject({
      compacted: true,
      event: "MESSAGES_UPSERT",
      instance: "evo_teste",
      data_count: 1,
      message_id: "msg-1",
      remote_jid_suffix: "9999",
    });
    expect(result.rawBody).not.toBe(raw);
    expect(JSON.parse(result.rawBody)).toMatchObject({
      compacted: true,
      event: "MESSAGES_UPSERT",
      message_id: "msg-1",
    });
    expect(JSON.stringify(result.payloadParsed)).not.toContain("5511999999999");
  });

  it("guarda somente resumo quando o histórico contém base64 grande", () => {
    const envelope = {
      event: "MESSAGES_SET",
      instance: "evo_teste",
      data: [{ key: { id: "msg-2" }, message: { base64: "x".repeat(70 * 1024) } }],
    };
    const raw = JSON.stringify(envelope);

    const result = compactEvolutionWebhookLog(envelope, raw);

    expect(result.payloadParsed).toMatchObject({
      compacted: true,
      event: "MESSAGES_SET",
      data_count: 1,
      message_id: "msg-2",
    });
    expect(result.rawBody.length).toBeLessThan(1_000);
    expect(JSON.stringify(result.payloadParsed)).not.toContain("x".repeat(100));
  });
});
