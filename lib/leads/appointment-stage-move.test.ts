import { describe, expect, it } from "vitest";
import { APPOINTMENT_STAGE_SLUG } from "./appointment-stage-move";

describe("appointment stage mapping", () => {
  it("uses opt-in stage slugs without treating cancellation as a lost deal", () => {
    expect(APPOINTMENT_STAGE_SLUG.pending).toBe("agendamento-solicitado");
    expect(APPOINTMENT_STAGE_SLUG.confirmed).toBe("agendado");
    expect("cancelled" in APPOINTMENT_STAGE_SLUG).toBe(false);
  });
});
