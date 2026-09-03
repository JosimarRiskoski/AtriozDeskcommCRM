import { describe, expect, it } from "vitest";

import { shouldShowKanbanOverflowCue } from "@/lib/kanban/overflow-cue";

describe("shouldShowKanbanOverflowCue", () => {
  it("mostra uma dica quando há cartões abaixo da área visível", () => {
    expect(
      shouldShowKanbanOverflowCue({ scrollTop: 0, clientHeight: 400, scrollHeight: 640 }),
    ).toBe(true);
  });

  it("não mostra a dica quando todos os cartões cabem", () => {
    expect(
      shouldShowKanbanOverflowCue({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 }),
    ).toBe(false);
  });

  it("remove a dica ao chegar ao último cartão", () => {
    expect(
      shouldShowKanbanOverflowCue({ scrollTop: 240, clientHeight: 400, scrollHeight: 640 }),
    ).toBe(false);
  });
});
