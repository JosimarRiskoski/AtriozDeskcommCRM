import { describe, expect, it } from "vitest";

import { buildGoogleAuthorizeUrl } from "./google";

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
