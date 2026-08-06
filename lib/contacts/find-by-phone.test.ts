import { describe, expect, it } from "vitest";

import { findActiveContactByPhone } from "@/lib/contacts/find-by-phone";

function fakeClient(rows: Array<{ id: string; phone_number?: string }>) {
  const calls: Array<{ method: string; value: unknown }> = [];
  const chain = {
    select: () => chain,
    eq: (field: string, value: unknown) => {
      calls.push({ method: `eq:${field}`, value });
      return chain;
    },
    in: (field: string, value: unknown) => {
      calls.push({ method: `in:${field}`, value });
      return chain;
    },
    is: (field: string, value: unknown) => {
      calls.push({ method: `is:${field}`, value });
      return chain;
    },
    limit: async () => ({ data: rows, error: null }),
  };
  return {
    calls,
    client: { from: () => chain },
  };
}

describe("findActiveContactByPhone", () => {
  it("consulta a forma atual e a forma legada do nono digito", async () => {
    const fake = fakeClient([{ id: "contact-1" }]);
    await expect(
      findActiveContactByPhone(fake.client as never, "org-1", "+5511988765432"),
    ).resolves.toEqual({ kind: "found", contactId: "contact-1" });
    expect(fake.calls).toContainEqual({
      method: "in:phone_number",
      value: ["+5511988765432", "+551188765432"],
    });
  });

  it("nao escolhe silenciosamente quando ha dois contatos", async () => {
    const fake = fakeClient([{ id: "contact-1" }, { id: "contact-2" }]);
    await expect(
      findActiveContactByPhone(fake.client as never, "org-1", "+5511988765432"),
    ).resolves.toEqual({
      kind: "ambiguous",
      contactIds: ["contact-1", "contact-2"],
    });
  });

  it("prioriza a representacao exata entregue pelo provedor", async () => {
    const fake = fakeClient([
      { id: "canonical", phone_number: "+5511988765432" },
      { id: "legacy", phone_number: "+551188765432" },
    ]);
    await expect(
      findActiveContactByPhone(
        fake.client as never,
        "org-1",
        "+5511988765432",
        "+551188765432",
      ),
    ).resolves.toEqual({ kind: "found", contactId: "legacy" });
  });
});
