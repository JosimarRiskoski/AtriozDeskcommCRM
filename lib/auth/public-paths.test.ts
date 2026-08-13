import { describe, expect, it } from "vitest";

import { isPublicPath } from "./public-paths";

describe("isPublicPath", () => {
  it("libera somente o callback OAuth exato do Google Agenda", () => {
    expect(isPublicPath("/api/v1/integrations/google-calendar/callback")).toBe(true);
    expect(isPublicPath("/api/v1/integrations/google-calendar/callback/admin")).toBe(false);
    expect(isPublicPath("/api/v1/integrations/google-calendar")).toBe(false);
  });
});
