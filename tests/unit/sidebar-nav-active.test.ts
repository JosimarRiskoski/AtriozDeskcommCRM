import { describe, expect, it } from "vitest";

import { isSidebarNavActive } from "@/lib/shell/nav-active";

describe("isSidebarNavActive", () => {
  it("mantém Kanban destacado ao abrir um funil", () => {
    expect(isSidebarNavActive("/app/pipelines/2da8162c-ed52-4527-a37c-9b8111b34221", "/app/kanban")).toBe(true);
  });

  it("não destaca Kanban em outra área", () => {
    expect(isSidebarNavActive("/app/team", "/app/kanban")).toBe(false);
  });

  it("preserva a regra de subrotas das demais áreas", () => {
    expect(isSidebarNavActive("/app/team/invite", "/app/team")).toBe(true);
  });
});
