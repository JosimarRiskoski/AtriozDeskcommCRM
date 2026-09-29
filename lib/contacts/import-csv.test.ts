import { describe, expect, it } from "vitest";
import { parseContactImportCsv } from "./import-csv";

describe("parseContactImportCsv", () => {
  it("aceita CSV com ponto e vírgula e normaliza telefone", () => {
    const rows = parseContactImportCsv("Nome;Telefone;Email\nAna;11999998888;ANA@EXEMPLO.COM");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("valid");
    expect(rows[0]?.input?.phone_number).toBe("+5511999998888");
    expect(rows[0]?.email).toBe("ana@exemplo.com");
    expect(rows[0]?.input?.consent).toEqual({ status: "unknown" });
  });

  it("ignora duplicados dentro do arquivo e linhas sem identificador", () => {
    const rows = parseContactImportCsv("nome,telefone,email\nAna,11999998888,\nAna 2,11999998888,\nSem dados,,");
    expect(rows.map((row) => row.status)).toEqual(["valid", "duplicate_file", "invalid"]);
  });

  it("permite email sem telefone, mas rejeita email inválido", () => {
    const rows = parseContactImportCsv("nome,email\nAna,ana@exemplo.com\nBob,errado");
    expect(rows.map((row) => row.status)).toEqual(["valid", "invalid"]);
  });

  it("linha inválida não bloqueia um contato válido posterior", () => {
    const rows = parseContactImportCsv("nome,telefone,email\nAna,123,ana@exemplo.com\nAna,11999998888,ana@exemplo.com");
    expect(rows.map((row) => row.status)).toEqual(["invalid", "valid"]);
  });

  it("exige uma coluna de identificação", () => {
    expect(() => parseContactImportCsv("nome\nAna")).toThrow("telefone ou email");
  });
});
