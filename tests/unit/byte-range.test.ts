import { describe, expect, it } from "vitest";

import { resolveByteRange } from "@/lib/http/byte-range";

describe("resolveByteRange", () => {
  it("aceita intervalo fechado", () => {
    expect(resolveByteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
  });

  it("limita o final ao tamanho do recurso", () => {
    expect(resolveByteRange("bytes=90-999", 100)).toEqual({ start: 90, end: 99 });
  });

  it("aceita intervalo aberto", () => {
    expect(resolveByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
  });

  it("resolve os últimos N bytes", () => {
    expect(resolveByteRange("bytes=-20", 100)).toEqual({ start: 80, end: 99 });
  });

  it("rejeita intervalo fora do recurso", () => {
    expect(resolveByteRange("bytes=100-120", 100)).toBe("unsatisfiable");
  });

  it("ignora cabeçalho que não é Range de bytes simples", () => {
    expect(resolveByteRange("items=1-2", 100)).toBeNull();
  });
});
