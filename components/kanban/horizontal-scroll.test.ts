import { describe, expect, it } from "vitest";

import { getKanbanHorizontalScrollMax } from "@/lib/kanban/horizontal-scroll";

describe("getKanbanHorizontalScrollMax", () => {
  it("informa quando o quadro ultrapassa a largura visível", () => {
    expect(getKanbanHorizontalScrollMax(1800, 1000)).toBe(800);
  });

  it("não exibe controle horizontal quando tudo cabe", () => {
    expect(getKanbanHorizontalScrollMax(1000, 1000)).toBe(0);
  });
});
