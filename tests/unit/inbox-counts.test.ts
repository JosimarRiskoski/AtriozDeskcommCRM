import { describe, expect, it } from "vitest";

import { loadConversationCounts } from "@/lib/inbox/counts";

describe("loadConversationCounts", () => {
  it("usa uma única agregação RLS-scoped e normaliza a resposta", async () => {
    const rpc = async (name: "fn_inbox_counts", args: { p_org: string }) => {
      expect(name).toBe("fn_inbox_counts");
      expect(args).toEqual({ p_org: "org-1" });
      return {
        data: { u: "3", a: 2, m: 1, t: "7" },
        error: null,
      };
    };

    await expect(loadConversationCounts({ rpc }, "org-1")).resolves.toEqual({
      unassigned: 3,
      automatic: 2,
      mine: 1,
      all: 7,
    });
  });

  it("não transforma valores inválidos em contagens falsas", async () => {
    const rpc = async () => ({
      data: { u: null, a: "x", m: -1, t: null },
      error: null,
    });

    await expect(
      loadConversationCounts({ rpc: rpc as never }, "org-1"),
    ).resolves.toEqual({ unassigned: 0, automatic: 0, mine: 0, all: 0 });
  });
});
