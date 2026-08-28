import { afterEach, describe, expect, it, vi } from "vitest";

import { buildGoogleAuthorizeUrl, GoogleSyncTokenExpiredError, listGoogleEvents } from "./google";

afterEach(() => vi.unstubAllGlobals());

describe("buildGoogleAuthorizeUrl", () => {
  it("solicita refresh token, consentimento e os escopos de agenda", () => {
    const value = buildGoogleAuthorizeUrl(
      {
        clientId: "client-id",
        clientSecret: "secret",
        redirectUri: "https://crm.example.com/api/v1/integrations/google-calendar/callback",
      },
      "signed-state",
    );
    const url = new URL(value);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("signed-state");
    expect(url.searchParams.get("scope")).toContain("calendar.events");
  });
});

describe("listGoogleEvents", () => {
  it("pagina sem duplicar e devolve o token incremental final", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ id: "a" }], nextPageToken: "page-2" })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ id: "b" }], nextSyncToken: "sync-final" })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = await listGoogleEvents("token", "primary", {
      timeMin: "2026-01-01T00:00:00.000Z",
    });
    expect(result.events.map((event) => event.id)).toEqual(["a", "b"]);
    expect(result.nextSyncToken).toBe("sync-final");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("pageToken=page-2");
  });

  it("sinaliza token expirado para refazer a carga completa", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 410 })));
    await expect(listGoogleEvents("token", "primary", { syncToken: "velho" })).rejects.toBeInstanceOf(
      GoogleSyncTokenExpiredError,
    );
  });
});
