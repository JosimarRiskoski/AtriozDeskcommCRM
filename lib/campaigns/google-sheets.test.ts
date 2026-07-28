import { describe, expect, it } from "vitest";
import { extractSpreadsheetId, rowsToCsv } from "./google-sheets";
import { previewCampaignCsv } from "./csv";

describe("Google Sheets campaign source", () => {
  it("extracts a spreadsheet id without accepting arbitrary URLs", () => {
    const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
    expect(extractSpreadsheetId(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`)).toBe(
      id,
    );
    expect(extractSpreadsheetId(id)).toBe(id);
    expect(() => extractSpreadsheetId("https://evil.example/list.csv")).toThrow(
      "invalid_spreadsheet",
    );
  });

  it("preserves quoted cells and uses the same consent validation as CSV", () => {
    const csv = rowsToCsv([
      ["Nome", "Telefone", "Consentimento"],
      ['Maria "Silva"', "47999999999", "sim"],
    ]);
    const preview = previewCampaignCsv(csv);
    expect(preview).toHaveLength(1);
    expect(preview[0]).toMatchObject({
      name: 'Maria "Silva"',
      status: "eligible",
      consent_confirmed: true,
    });
  });

  it("rejects more than 2,000 contacts", () => {
    const rows = Array.from({ length: 2_002 }, (_, index) => [
      index === 0 ? "Telefone" : String(index),
    ]);
    expect(() => rowsToCsv(rows)).toThrow("sheet_too_many_rows");
  });
});
