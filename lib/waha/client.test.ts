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
