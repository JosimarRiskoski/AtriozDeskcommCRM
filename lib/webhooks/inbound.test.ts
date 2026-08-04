import { describe, it, expect } from "vitest";
import {
  mapInboundPayload,
  normalizePhoneBR,
  verifyInboundSignature,
  isExternalAutomationActive,
} from "@/lib/webhooks/inbound";
import { createHmac } from "node:crypto";

describe("normalizePhoneBR", () => {
  it("já em E.164 passa direto", () =>
    expect(normalizePhoneBR("+5511998765432")).toBe("+5511998765432"));
  it("DDD+numero BR ganha +55", () =>
    expect(normalizePhoneBR("11 99876-5432")).toBe("+5511998765432"));
  it("com 55 na frente sem +", () =>
    expect(normalizePhoneBR("5511998765432")).toBe("+5511998765432"));
  it("fixo BR 10 dígitos", () => expect(normalizePhoneBR("1133334444")).toBe("+551133334444"));
  it("celular BR antigo ganha o nono digito", () =>
    expect(normalizePhoneBR("11 8876-5432")).toBe("+5511988765432"));
  it("lixo → null", () => expect(normalizePhoneBR("abc")).toBeNull());
  it("vazio/não-string → null", () => {
    expect(normalizePhoneBR("")).toBeNull();
    expect(normalizePhoneBR(42 as unknown)).toBeNull();
  });
});

describe("mapInboundPayload", () => {
  it("aliases default: nome/telefone/email", () => {
    const m = mapInboundPayload({ nome: "Ana", telefone: "11998765432", email: "a@b.com" });
    expect(m).toMatchObject({ name: "Ana", phone: "+5511998765432", email: "a@b.com" });
  });
  it("whatsapp como alias de phone; extras viram custom_fields; utm_* vira source_metadata", () => {
    const m = mapInboundPayload({
      name: "Bo",
      whatsapp: "+5511998765432",
      empresa: "ACME",
      utm_source: "instagram",
    });
    expect(m.phone).toBe("+5511998765432");
    expect(m.custom_fields).toEqual({ empresa: "ACME" });
    expect(m.source_metadata).toEqual({ utm_source: "instagram" });
  });
  it("field_map custom tem precedência sobre defaults", () => {
    const m = mapInboundPayload({ contato: "Zé" }, { name: ["contato"] });
    expect(m.name).toBe("Zé");
  });
  it("payload sem nada mapeável → tudo null e extras preservados", () => {
    const m = mapInboundPayload({ foo: "bar" });
    expect(m.name).toBeNull();
    expect(m.phone).toBeNull();
    expect(m.custom_fields).toEqual({ foo: "bar" });
  });
  it("valores não-string são stringificados em custom_fields; objetos aninhados descartados", () => {
    const m = mapInboundPayload({ nome: "Ana", idade: 30, nested: { a: 1 } });
    expect(m.custom_fields).toEqual({ idade: "30" });
  });
  it("preserva campanha e anúncio de tráfego pago no histórico da origem", () => {
    const mapped = mapInboundPayload({
      telefone: "11998765432",
      campaign_id: "cmp-10",
      campaign_name: "Energia agosto",
      ad_id: "ad-20",
      adset_name: "São Paulo",
    });
    expect(mapped.source_metadata).toEqual({
      campaign_id: "cmp-10",
      campaign_name: "Energia agosto",
      ad_id: "ad-20",
      adset_name: "São Paulo",
    });
    expect(mapped.custom_fields).toEqual({});
  });
});

describe("verifyInboundSignature", () => {
  const body = '{"nome":"Ana"}';
  const secret = "s3cr3t";
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  it("assinatura válida", () => expect(verifyInboundSignature(body, sig, secret)).toBe(true));
  it("assinatura errada", () =>
    expect(verifyInboundSignature(body, "deadbeef", secret)).toBe(false));
  it("header ausente", () => expect(verifyInboundSignature(body, null, secret)).toBe(false));
  it("header com tamanho diferente não lança (timingSafeEqual exige mesmo length)", () =>
    expect(verifyInboundSignature(body, "abc", secret)).toBe(false));
});

describe("isExternalAutomationActive", () => {
  it.each([true, 1, "1", "ACTIVE", "executando"])(
    "reconhece %s como automação externa ativa",
    (value) => expect(isExternalAutomationActive(value)).toBe(true),
  );
  it.each([false, 0, null, "paused", ""])("não trata %s como ativa", (value) => {
    expect(isExternalAutomationActive(value)).toBe(false);
  });
});
