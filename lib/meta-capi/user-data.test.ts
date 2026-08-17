import { describe, expect, it } from "vitest";
import { normalizedMetaUserData } from "./user-data";
describe("Meta CAPI user data", () => {
  it("normaliza e aplica SHA-256 sem devolver PII", () => {
    const data = normalizedMetaUserData(
      "+55 (47) 99999-9999",
      " TESTE@EXAMPLE.COM ",
      "contact-123",
    );
    expect(data.ph?.[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(data.em?.[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(data.external_id?.[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(data)).not.toContain("5547");
    expect(JSON.stringify(data)).not.toContain("example.com");
    expect(JSON.stringify(data)).not.toContain("contact-123");
  });

  it("preserva fbc e fbp reais sem fabricar identificadores", () => {
    const data = normalizedMetaUserData(null, null, null, {
      fbc: " fb.1.123.abc ",
      fbp: "fb.1.456.def",
    });
    expect(data).toEqual({ fbc: "fb.1.123.abc", fbp: "fb.1.456.def" });
    expect(normalizedMetaUserData()).toEqual({});
  });
});
