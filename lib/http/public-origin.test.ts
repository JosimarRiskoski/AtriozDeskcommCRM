import { describe, expect, it } from "vitest";

import { resolvePublicOrigin } from "./public-origin";

describe("resolvePublicOrigin", () => {
  it("prefere o domínio público encaminhado pelo proxy", () => {
    const headers = new Headers({
      host: "0.0.0.0:3000",
      "x-forwarded-host": "crm.atriozagencia.cloud",
      "x-forwarded-proto": "https",
    });
    expect(resolvePublicOrigin(headers)).toBe("https://crm.atriozagencia.cloud");
  });

  it("aceita listas adicionadas por mais de um proxy", () => {
    const headers = new Headers({
      "x-forwarded-host": "crm.atriozagencia.cloud, 0.0.0.0:3000",
      "x-forwarded-proto": "https, http",
    });
    expect(resolvePublicOrigin(headers)).toBe("https://crm.atriozagencia.cloud");
  });
});
