import { describe, expect, it } from "vitest";

import { inboxTabToFilter } from "@/lib/inbox/tab-filter";

describe("inboxTabToFilter", () => {
  it("faz a Fila espelhar a definição canônica: aberta e sem responsável", () => {
    expect(inboxTabToFilter("unassigned")).toEqual({
      assigned_to: "unassigned",
      status: "open",
    });
  });

  it("preserva a visão de atendimentos automáticos", () => {
    expect(inboxTabToFilter("ai")).toEqual({ command: "automatic" });
  });
});
