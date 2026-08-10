import { afterEach, describe, expect, it, vi } from "vitest";

import { EvolutionClient } from "@/lib/evolution/client";
import { ackFromEvolutionUpdate, advanceEvolutionReceipt } from "@/lib/evolution/receipts";

describe("recibos da Evolution", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [1, 0],
    [2, 1],
    [3, 2],
    [4, 3],
    [5, 4],
    ["PENDING", 0],
    ["SERVER_ACK", 1],
    ["DELIVERY_ACK", 2],
    ["READ", 3],
    ["PLAYED", 4],
  ])("normaliza %s para ACK %s", (status, expected) => {
    expect(ackFromEvolutionUpdate({ update: { status } })).toBe(expected);
  });

  it("envia as chaves corretas ao marcar mensagens como lidas", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new EvolutionClient("https://evolution.test", "secret");
    await client.markMessagesAsRead("crm principal", [
      { id: "message-id", fromMe: false, remoteJid: "5511999999999@s.whatsapp.net" },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://evolution.test/chat/markMessageAsRead/crm%20principal",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          readMessages: [
            { id: "message-id", fromMe: false, remoteJid: "5511999999999@s.whatsapp.net" },
          ],
        }),
      }),
    );
  });

  it("gera alerta observável quando nenhum ID de recibo é encontrado", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ matched_count: 0, updated_count: 0 }], error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    await expect(
      advanceEvolutionReceipt(rpc, {
        organizationId: "org-1",
        externalIds: ["full-id", "short-id"],
        ack: 3,
        provider: "evolution",
      }),
    ).resolves.toEqual({ matched: 0, updated: 0 });

    expect(rpc).toHaveBeenNthCalledWith(2, "emit_event", expect.objectContaining({
      p_event_type: "whatsapp.receipt_unmatched",
      p_payload: { external_ids: ["full-id", "short-id"], ack: 3 },
    }));
  });

  it("não gera alerta quando o recibo encontra a mensagem", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ matched_count: 1, updated_count: 1 }],
      error: null,
    });
    await expect(
      advanceEvolutionReceipt(rpc, {
        organizationId: "org-1",
        externalIds: ["id"],
        ack: 2,
        provider: "evolution",
      }),
    ).resolves.toEqual({ matched: 1, updated: 1 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("recupera base64 de mídia pelo endpoint oficial", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ base64: "AQID", mimetype: "audio/ogg" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new EvolutionClient("https://evolution.test/", "secret");
    const message = { key: { id: "message-id" }, message: { audioMessage: {} } };
    await expect(client.getBase64FromMediaMessage("principal", message)).resolves.toEqual(
      expect.objectContaining({ base64: "AQID", mimetype: "audio/ogg" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://evolution.test/chat/getBase64FromMediaMessage/principal",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ message }) }),
    );
  });
});
