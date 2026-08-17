import { describe, expect, it } from "vitest";

import {
  metaConversionCanBeRequested,
  metaConversionEventId,
  metaConversionIsFinal,
} from "./manual";

describe("conversao manual da Meta", () => {
  it("gera um event_id estavel por oportunidade", () => {
    expect(metaConversionEventId("lead-123")).toBe("crm-conversion-lead-123");
    expect(metaConversionEventId("lead-123")).toBe(metaConversionEventId("lead-123"));
  });

  it("bloqueia novo envio depois do sucesso", () => {
    expect(metaConversionIsFinal("sent")).toBe(true);
    expect(metaConversionCanBeRequested("sent")).toBe(false);
  });

  it("permite repetir somente falhas e descartes", () => {
    expect(metaConversionCanBeRequested(null)).toBe(true);
    expect(metaConversionCanBeRequested("failed")).toBe(true);
    expect(metaConversionCanBeRequested("skipped")).toBe(true);
    expect(metaConversionCanBeRequested("pending")).toBe(false);
    expect(metaConversionCanBeRequested("processing")).toBe(false);
  });
});
