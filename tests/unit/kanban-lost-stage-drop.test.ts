import { describe, expect, it } from "vitest";
import { shouldRequestLostReason } from "@/lib/kanban/drop-policy";
import type { Lead } from "@/lib/types/leads";
import type { Stage } from "@/lib/kanban/types";

const lead = { status: "open" } as Lead;
const regularStage = { is_lost: false } as Stage;
const lostStage = { is_lost: true } as Stage;

describe("drop em etapa final de perda", () => {
  it("solicita o motivo antes de mover um lead aberto", () => {
    expect(shouldRequestLostReason(lead, lostStage)).toBe(true);
  });

  it("não interrompe movimentos comuns nem reordenação de lead já perdido", () => {
    expect(shouldRequestLostReason(lead, regularStage)).toBe(false);
    expect(shouldRequestLostReason({ ...lead, status: "lost" }, lostStage)).toBe(false);
  });
});
