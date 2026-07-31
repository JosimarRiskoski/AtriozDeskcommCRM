import { afterEach, describe, expect, it, vi } from "vitest";

import { WahaClient } from "./client";

describe("WahaClient.sendPoll", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses the official WAHA sendPoll payload", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "poll-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new WahaClient("http://waha:3000", "secret");
    await client.sendPoll("tenant", "5511999999999@c.us", "Qual horário?", ["Manhã", "Tarde"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://waha:3000/api/sendPoll",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          session: "tenant",
          chatId: "5511999999999@c.us",
          poll: {
            name: "Qual horário?",
            options: ["Manhã", "Tarde"],
            multipleAnswers: false,
          },
        }),
      }),
    );
  });

  it("surfaces a provider failure so the message handler can use text fallback", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("unsupported", { status: 422 }));
    const client = new WahaClient("http://waha:3000", "secret");
    await expect(
      client.sendPoll("tenant", "5511999999999@c.us", "Qual horário?", ["Manhã", "Tarde"]),
    ).rejects.toThrow("waha_poll_422");
  });
});

describe("WahaClient.checkNumberExists", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses check-exists and preserves the canonical @lid chatId", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ numberExists: true, chatId: "203392655843435@lid" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new WahaClient("http://waha:3000", "secret");

    await expect(client.checkNumberExists("tenant", "+55 (47) 98897-6484")).resolves.toEqual({
      numberExists: true,
      chatId: "203392655843435@lid",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://waha:3000/api/contacts/check-exists?phone=5547988976484&session=tenant",
      { headers: { "X-Api-Key": "secret" } },
    );
  });

  it("returns a deterministic missing result without inventing a chatId", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ numberExists: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new WahaClient("http://waha:3000", "secret");
    await expect(client.checkNumberExists("tenant", "5547000000000")).resolves.toEqual({
      numberExists: false,
      chatId: null,
    });
  });

  it("surfaces temporary provider failures for the campaign retry policy", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("temporary failure", { status: 500 }),
    );
    const client = new WahaClient("http://waha:3000", "secret");
    await expect(client.checkNumberExists("tenant", "5547988976484")).rejects.toThrow(
      "waha_check_exists_500",
    );
  });
});
