import { describe, expect, it } from "vitest";

import { metaCapiErrorLabel } from "./errors";

describe("metaCapiErrorLabel", () => {
  it("traduz falhas comuns sem mostrar o payload tecnico", () => {
    expect(metaCapiErrorLabel('meta_http_401:{"error":"token"}')).toContain("invalido");
    expect(metaCapiErrorLabel('meta_http_400:{"error":"payload"}')).not.toContain("payload");
  });
});
