import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EvolutionClient, evolutionRecipient, parseEvolutionMessageId } from "./client";

describe("EvolutionClient webhook configuration", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("creates an instance with the secure unified webhook and media payload enabled", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ instance: { state: "close" } }), { status: 200 }),
    );
    const client = new EvolutionClient("http://evolution:8080", "secret");
    await client.createInstance({
      instanceName: "crm-1",
      webhookUrl: "https://crm.example.com/api/v1/webhooks/evolution/token",
      webhookHeaders: { "x-atrios-evolution-secret": "webhook-secret" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://evolution:8080/instance/create",
      expect.objectContaining({
        method: "POST",
        body: expect.any(String),
      }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      instanceName: "crm-1",
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      syncFullHistory: true,
      webhook: {
        enabled: true,
        byEvents: false,
        base64: true,
        headers: { "x-atrios-evolution-secret": "webhook-secret" },
      },
    });
  });

  it("preserves the Evolution v2 webhook field names when updating an instance", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const client = new EvolutionClient("http://evolution:8080", "secret");
    await client.setWebhook("crm-1", {
      webhookUrl: "https://crm.example.com/api/v1/webhooks/evolution/token",
      webhookHeaders: { "x-atrios-evolution-secret": "webhook-secret" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://evolution:8080/webhook/set/crm-1",
      expect.objectContaining({
        method: "POST",
        body: expect.stringMatching(/"webhook":\{.*"enabled":true.*"byEvents":false/),
      }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      webhook: { base64: true, enabled: true, byEvents: false },
    });
  });
});

describe("Evolution helpers", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("keeps group JIDs and normalizes individual recipients", () => {
    expect(evolutionRecipient("5511999999999@c.us")).toBe("5511999999999");
    expect(evolutionRecipient("120363000000000000@g.us")).toBe("120363000000000000@g.us");
  });

  it("uses the external message id returned by Evolution", () => {
    expect(parseEvolutionMessageId({ key: { id: "ABC" } })).toBe("ABC");
    expect(parseEvolutionMessageId({ messageId: "XYZ" })).toBe("XYZ");
  });

  it("reads the QR returned by Evolution v2 in its base64 field", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ base64: "data:image/png;base64,QR" }), { status: 200 }),
    );
    const client = new EvolutionClient("http://evolution:8080", "secret");

    const connection = await client.connect("crm-1");

    expect(connection.qrcode).toBe("data:image/png;base64,QR");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://evolution:8080/instance/connect/crm-1",
      expect.anything(),
    );
  });

  it("reads the nested QR returned during instance creation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ qrcode: { base64: "data:image/png;base64,NESTED", count: 1 } }),
        { status: 200 },
      ),
    );
    const client = new EvolutionClient("http://evolution:8080", "secret");

    const connection = await client.createInstance({
      instanceName: "crm-1",
      webhookUrl: "https://crm.example.com/webhook",
    });

    expect(connection.qrcode).toBe("data:image/png;base64,NESTED");
  });

  it("falls back to fetchInstances when this Evolution image lacks connectionState", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ name: "evo_org_123", connectionStatus: "open" }]),
          { status: 200 },
        ),
      );
    const client = new EvolutionClient("http://evolution:8080", "secret");

    const connection = await client.connectionState("org_123");

    expect(connection.state).toBe("open");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://evolution:8080/instance/fetchInstances",
      expect.anything(),
    );
  });
});
