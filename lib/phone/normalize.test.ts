import { describe, expect, it } from "vitest";

import {
  areSamePhoneIdentity,
  normalizePhoneBR,
  phoneIdentityCandidates,
} from "@/lib/phone/normalize";

describe("normalizePhoneBR", () => {
  it.each([
    ["+5511998765432", "+5511998765432"],
    ["11 99876-5432", "+5511998765432"],
    ["5511998765432", "+5511998765432"],
    ["11 3333-4444", "+551133334444"],
    ["+551133334444", "+551133334444"],
  ])("normaliza %s", (raw, expected) => {
    expect(normalizePhoneBR(raw)).toBe(expected);
  });

  it.each([
    ["11 8876-5432", "+5511988765432"],
    ["551188765432", "+5511988765432"],
    ["+551188765432", "+5511988765432"],
  ])("converte celular BR antigo %s para o nono digito", (raw, expected) => {
    expect(normalizePhoneBR(raw)).toBe(expected);
  });

  it.each(["", "abc", "123", "+00000000"])("rejeita %s", (raw) => {
    expect(normalizePhoneBR(raw)).toBeNull();
  });
});

describe("phoneIdentityCandidates", () => {
  it("lista a forma atual e a forma legada do mesmo celular", () => {
    expect(phoneIdentityCandidates("+5511988765432")).toEqual(["+5511988765432", "+551188765432"]);
  });

  it("nao cria alias para telefone fixo", () => {
    expect(phoneIdentityCandidates("+551133334444")).toEqual(["+551133334444"]);
  });
});

describe("areSamePhoneIdentity", () => {
  it("aceita o mesmo celular antes e depois do nono digito", () => {
    expect(areSamePhoneIdentity("+551188765432", "+5511988765432")).toBe(true);
  });

  it("rejeita dois telefones validos, mas diferentes", () => {
    expect(areSamePhoneIdentity("+551133334444", "+552233334444")).toBe(false);
  });
});
