import { normalizePhoneBR } from "@/lib/webhooks/inbound";

export interface CampaignCsvRow {
  row: number;
  name: string | null;
  email: string | null;
  phone_normalized: string | null;
  consent_confirmed: boolean;
  status: "eligible" | "invalid_phone" | "missing_consent" | "duplicate";
}

const PHONE_HEADERS = ["telefone", "phone", "celular", "whatsapp", "numero", "número"];
const NAME_HEADERS = ["nome", "name", "cliente"];
const EMAIL_HEADERS = ["email", "e-mail", "mail"];
const CONSENT_HEADERS = ["consentimento", "consent", "optin", "opt-in", "autorizado"];
const TRUE_VALUES = new Set(["1", "true", "sim", "yes", "s", "y", "autorizado", "aceito"]);

function normalizeHeader(value: string): string {
  return value.trim().toLocaleLowerCase("pt-BR");
}

/** CSV pequeno e humano: vírgula ou ponto-e-vírgula, aspas e aspas escapadas. */
export function parseCsvRecords(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const delimiter = (text.split(/\r?\n/, 1)[0]?.match(/;/g)?.length ?? 0) >
    (text.split(/\r?\n/, 1)[0]?.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(field.trim()); field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field.trim()); field = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function headerIndex(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) => aliases.includes(header));
}

export function previewCampaignCsv(input: string, maxRows = 2_000): CampaignCsvRow[] {
  const records = parseCsvRecords(input);
  if (records.length < 2) return [];
  const headers = records[0]!.map(normalizeHeader);
  const phoneIndex = headerIndex(headers, PHONE_HEADERS);
  if (phoneIndex < 0) throw new Error("missing_phone_column");
  const nameIndex = headerIndex(headers, NAME_HEADERS);
  const emailIndex = headerIndex(headers, EMAIL_HEADERS);
  const consentIndex = headerIndex(headers, CONSENT_HEADERS);
  const seen = new Set<string>();

  return records.slice(1, maxRows + 1).map((record, index) => {
    const phone = normalizePhoneBR(record[phoneIndex]);
    const consent = consentIndex >= 0 && TRUE_VALUES.has(normalizeHeader(record[consentIndex] ?? ""));
    let status: CampaignCsvRow["status"] = "eligible";
    if (!phone) status = "invalid_phone";
    else if (seen.has(phone)) status = "duplicate";
    else if (!consent) status = "missing_consent";
    if (phone) seen.add(phone);
    return {
      row: index + 2,
      name: nameIndex >= 0 ? record[nameIndex]?.trim() || null : null,
      email: emailIndex >= 0 ? record[emailIndex]?.trim() || null : null,
      phone_normalized: phone,
      consent_confirmed: consent,
      status,
    };
  });
}
