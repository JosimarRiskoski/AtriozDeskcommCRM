import { describe, expect, it } from "vitest";

import { CASE_ACTIONS, CASE_REPLY_DISABLED_REASON } from "./case-copy";

describe("ações dos casos humanos", () => {
  it("oferece cancelamento para fechar casos abertos por engano", () => {
    expect(CASE_ACTIONS).toContainEqual(
      expect.objectContaining({ action: "cancelled", label: "Cancelar caso" }),
    );
    expect(CASE_REPLY_DISABLED_REASON.awaiting_lead).toContain("cancelá-lo");
  });
});
