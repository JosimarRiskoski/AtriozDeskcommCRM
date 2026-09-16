import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/next-path";
import { classifyLoginError } from "@/lib/auth/login-error";

describe("authentication destinations", () => {
  it.each([undefined, "https://outside.test", "//outside.test", "/\\outside.test", "/\n/outside.test", "javascript:alert(1)"])("rejects unsafe destination %s", (value) => {
    expect(safeNextPath(value)).toBe("/app/inbox");
  });
  it("preserves a local invitation or CRM destination", () => {
    expect(safeNextPath("/team/accept-invite/example?step=confirm#details")).toBe("/team/accept-invite/example?step=confirm#details");
  });
});

describe("login failures", () => {
  it.each([500, 502, 503, 504, 0])("does not label service error %s as bad credentials", (status) => {
    expect(classifyLoginError({ status })).toBe("service_unavailable");
  });
  it("recognizes transport errors without HTTP status", () => {
    expect(classifyLoginError({ name: "AuthRetryableFetchError" })).toBe("service_unavailable");
  });
  it("reports throttling", () => {
    expect(classifyLoginError({ status: 429 })).toBe("rate_limited");
  });
  it.each(["invalid_credentials", "email_not_confirmed", "user_not_found"])("does not expose account state %s", (code) => {
    expect(classifyLoginError({ status: 400, code })).toBe("invalid_credentials");
  });
});
