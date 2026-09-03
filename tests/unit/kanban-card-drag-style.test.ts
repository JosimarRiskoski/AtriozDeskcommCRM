import { describe, expect, it } from "vitest";
import { mergeKanbanCardDragStyle } from "@/components/kanban/KanbanCard";

describe("KanbanCard drag style", () => {
  it("preserva os estilos de movimento do DnD ao aplicar a cor da etapa", () => {
    const style = mergeKanbanCardDragStyle(
      {
        transform: "translate(240px, 18px)",
        transition: "transform 200ms ease",
        position: "fixed",
        top: 120,
        left: 80,
      },
      "#2563eb",
    );

    expect(style).toMatchObject({
      transform: "translate(240px, 18px)",
      transition: "transform 200ms ease",
      position: "fixed",
      top: 120,
      left: 80,
      borderLeftColor: "#2563eb",
      "--kanban-stage-color": "#2563eb",
    });
  });
});
