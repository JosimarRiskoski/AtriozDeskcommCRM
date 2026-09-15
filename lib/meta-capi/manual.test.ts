import { describe, expect, it } from "vitest";

import {
  metaConversionCanBeRequested,
  metaConversionEventId,
  metaConversionHasDeliveryAuthorization,
  metaConversionIsFinal,
} from "./manual";

describe("conversao manual da Meta", () => {
  it("gera um event_id estavel por oportunidade e marco", () => {
    expect(metaConversionEventId("lead-123")).toBe("crm-meta:lead-123:purchase");
    expect(metaConversionEventId("lead-123", "Lead")).toBe("crm-meta:lead-123:lead");
    expect(metaConversionEventId("lead-123")).toBe(metaConversionEventId("lead-123"));
    expect(metaConversionEventId("lead-123", "Lead")).not.toBe(
      metaConversionEventId("lead-123", "Purchase"),
    );
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

  it("só libera a fila por confirmação humana ou regra automática identificada", () => {
    expect(
      metaConversionHasDeliveryAuthorization({
        requested_at: "2026-09-15T00:00:00.000Z",
        requested_by_user_id: "user-1",
      }),
    ).toBe(true);
    expect(
      metaConversionHasDeliveryAuthorization({
        requested_at: "2026-09-15T00:00:00.000Z",
        event_origin: "automatic",
        rule_id: "rule-1",
      }),
    ).toBe(true);
    expect(
      metaConversionHasDeliveryAuthorization({
        requested_at: "2026-09-15T00:00:00.000Z",
        event_origin: "automatic",
      }),
    ).toBe(false);
    expect(
      metaConversionHasDeliveryAuthorization({ requested_by_user_id: "user-1" }),
    ).toBe(false);
  });
});
