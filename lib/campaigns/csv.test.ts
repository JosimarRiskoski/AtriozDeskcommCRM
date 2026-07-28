import { describe, expect, it } from "vitest";
import { parseCsvRecords, previewCampaignCsv } from "./csv";

describe("campaign CSV", () => {
  it("lê ponto-e-vírgula, aspas e normaliza telefone brasileiro", () => {
    const rows = previewCampaignCsv('nome;telefone;consentimento\n"Maria, Silva";(47) 99999-8888;sim');
    expect(rows[0]).toMatchObject({ name: "Maria, Silva", phone_normalized: "+5547999998888", status: "eligible" });
  });

  it("separa falta de consentimento, telefone inválido e duplicado", () => {
    const rows = previewCampaignCsv("phone,consent\n11999998888,sim\n11999998888,sim\nabc,sim\n21988887777,não");
    expect(rows.map((row) => row.status)).toEqual(["eligible", "duplicate", "invalid_phone", "missing_consent"]);
  });

  it("preserva delimitador dentro de campo entre aspas", () => {
    expect(parseCsvRecords('nome,telefone\n"Silva, Maria",11999998888')).toEqual([
      ["nome", "telefone"], ["Silva, Maria", "11999998888"],
    ]);
  });
});
