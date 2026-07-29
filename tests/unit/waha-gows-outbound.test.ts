import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { outboundChatIdOf, type WahaPayload } from "@/lib/waha/ingest";

describe("outboundChatIdOf", () => {
  it("usa `to` no formato NOWEB", () => {
    expect(
      outboundChatIdOf({
        fromMe: true,
        from: "5511000000000@c.us",
        to: "5547999999999@c.us",
      }),
    ).toBe("5547999999999@c.us");
  });

  it("usa `from` no formato real do GOWS, onde `to` vem nulo", () => {
    const payload: WahaPayload = {
      id: "true_5511999999999@c.us_ABC",
      from: "5511999999999@c.us",
      fromMe: true,
      body: "resposta enviada pelo celular",
      _data: {
        Info: {
          Chat: "5511999999999@s.whatsapp.net",
          Sender: "5547888888888:1@s.whatsapp.net",
          IsFromMe: true,
        },
      },
    };

    expect(outboundChatIdOf(payload)).toBe("5511999999999@c.us");
  });

  it("aceita `_data.Info.Chat` como ultimo fallback do GOWS", () => {
    expect(
      outboundChatIdOf({
        fromMe: true,
        _data: { Info: { Chat: "5511888888888@s.whatsapp.net" } },
      }),
    ).toBe("5511888888888@s.whatsapp.net");
  });

  it("nao transforma remetente inbound em destinatario outbound", () => {
    expect(outboundChatIdOf({ fromMe: false, from: "5511777777777@c.us" })).toBe("");
  });
});
