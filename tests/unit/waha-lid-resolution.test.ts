import { afterEach, describe, expect, it, vi } from "vitest";

import { WahaClient } from "@/lib/waha/client";
import { resolveWahaChatId } from "@/lib/waha/send";

describe("WahaClient.getPhoneByLid", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("converte o PN retornado pelo WAHA em E.164", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ lid: "203392655843435@lid", pn: "554788976484@c.us" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new WahaClient("http://waha:3000", "secret");
    await expect(client.getPhoneByLid("org_123", "203392655843435@lid")).resolves.toBe(
      "+554788976484",
    );
    expect(fetchMock).toHaveBeenCalledWith("http://waha:3000/api/org_123/lids/203392655843435", {
      headers: { "X-Api-Key": "secret" },
    });
  });

  it("retorna null quando o WAHA ainda nao conhece o telefone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ lid: "203392655843435@lid", pn: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const client = new WahaClient("http://waha:3000", "secret");
    await expect(client.getPhoneByLid("org_123", "203392655843435")).resolves.toBeNull();
  });

  it("mantem 404 como ausencia de mapeamento, sem derrubar a ingestao", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    const client = new WahaClient("http://waha:3000", "secret");
    await expect(client.getPhoneByLid("org_123", "203392655843435")).resolves.toBeNull();
  });
});

describe("resolveWahaChatId", () => {
  it("prefers a WAHA-verified @lid over the guessed phone @c.us", () => {
    expect(
      resolveWahaChatId({
        isGroup: false,
        groupChatId: null,
        phoneNumber: "+5547988976484",
        waIdentity: "phone:+5547988976484",
        verifiedChatId: "203392655843435@lid",
      }),
    ).toBe("203392655843435@lid");
  });

  it("rejects an unsafe verified destination and keeps the phone fallback", () => {
    expect(
      resolveWahaChatId({
        isGroup: false,
        groupChatId: null,
        phoneNumber: "+5547988976484",
        waIdentity: "phone:+5547988976484",
        verifiedChatId: "unexpected-target",
      }),
    ).toBe("5547988976484@c.us");
  });
});
