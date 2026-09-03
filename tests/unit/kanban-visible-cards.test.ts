import { describe, expect, it } from "vitest";

import { getVisibleKanbanCards } from "@/lib/kanban/visible-cards";

describe("getVisibleKanbanCards", () => {
  it("mostra somente os três primeiros cartões enquanto a etapa está recolhida", () => {
    expect(getVisibleKanbanCards(["a", "b", "c", "d"], false)).toEqual(["a", "b", "c"]);
  });

  it("mantém todos os cartões quando a etapa é expandida", () => {
    expect(getVisibleKanbanCards(["a", "b", "c", "d"], true)).toEqual(["a", "b", "c", "d"]);
  });
});
