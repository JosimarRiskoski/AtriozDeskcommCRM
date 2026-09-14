import { describe, expect, it } from "vitest";

import { inboxTabToFilter } from "@/lib/inbox/tab-filter";

describe("inboxTabToFilter", () => {
  it("faz a Fila espelhar a definição canônica de atendimento humano pendente", () => {
    expect(inboxTabToFilter("unassigned")).toEqual({ command: "waiting" });
  });

  it("preserva a visão de atendimentos automáticos", () => {
    expect(inboxTabToFilter("ai")).toEqual({ command: "automatic" });
  });
});
