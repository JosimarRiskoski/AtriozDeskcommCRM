import { describe, expect, it } from "vitest";

import { visibleRetentionTraces } from "./retention-visibility";

const trace = (id: string, code: string, createdAt: string) => ({
  id,
  created_at: createdAt,
  vetoed_gate: "pacing",
  vetoed_code: code,
});

describe("visibleRetentionTraces", () => {
  it("oculta pacing anterior à alteração da proteção", () => {
    const result = visibleRetentionTraces(
      [
        trace("old", "outside_window", "2026-08-06T19:00:00.000Z"),
        trace("new", "outside_window", "2026-08-06T19:11:00.000Z"),
      ],
      "2026-08-06T19:10:00.000Z",
    );
    expect(result.map((item) => item.id)).toEqual(["new"]);
  });

  it("preserva vetos que não dependem da configuração de pacing", () => {
    const result = visibleRetentionTraces(
      [trace("case", "case_promise_without_case", "2026-08-06T19:00:00.000Z")],
      "2026-08-06T19:10:00.000Z",
    );
    expect(result).toHaveLength(1);
  });
});
