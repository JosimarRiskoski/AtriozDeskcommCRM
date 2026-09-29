import { parseCsvRecords } from "@/lib/campaigns/csv";
import { contactCreateSchema, type ContactCreate } from "@/lib/schemas/contacts";
import { phoneIdentityCandidates } from "@/lib/phone/normalize";

export const MAX_CONTACT_IMPORT_ROWS = 250;
export const MAX_CONTACT_IMPORT_BYTES = 2 * 1024 * 1024;

export type ContactImportRow = {
  row: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: "valid" | "invalid" | "duplicate_file" | "existing";
  reason: string | null;
  input: ContactCreate | null;
};

const normalizeHeader = (value: string) => value.trim().toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[\s_-]+/g, "");

export function parseContactImportCsv(csv: string): ContactImportRow[] {
  const records = parseCsvRecords(csv);
  if (records.length < 2) throw new Error("O CSV precisa de cabeçalho e ao menos um contato.");
  if (records.length - 1 > MAX_CONTACT_IMPORT_ROWS)
    throw new Error(`O limite é ${MAX_CONTACT_IMPORT_ROWS} contatos por arquivo.`);
  const headers = records[0]!.map(normalizeHeader);
  const index = (aliases: string[]) => headers.findIndex((header) => aliases.includes(header));
  const nameIndex = index(["nome", "name", "cliente"]);
  const phoneIndex = index(["telefone", "phone", "celular", "whatsapp", "numero"]);
  const emailIndex = index(["email", "mail"]);
  if (phoneIndex < 0 && emailIndex < 0)
    throw new Error("O CSV precisa da coluna telefone ou email.");
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();

  return records.slice(1).map((record, position) => {
    const name = nameIndex < 0 ? null : record[nameIndex]?.trim() || null;
    const rawPhone = phoneIndex < 0 ? "" : record[phoneIndex]?.trim() || "";
    const email = emailIndex < 0 ? null : record[emailIndex]?.trim().toLowerCase() || null;
    const parsed = contactCreateSchema.safeParse({
      ...(name ? { name } : {}),
      ...(rawPhone ? { phone_number: rawPhone } : {}),
      ...(email ? { email } : {}),
      source: "csv_import",
      consent: { status: "unknown" },
    });
    let status: ContactImportRow["status"] = "valid";
    let reason: string | null = null;
    const input = parsed.success ? parsed.data : null;
    if (record.length !== headers.length) {
      status = "invalid";
      reason = "Número de colunas diferente do cabeçalho.";
    } else if (!rawPhone && !email) {
      status = "invalid";
      reason = "Informe telefone ou email.";
    } else if (!parsed.success) {
      status = "invalid";
      reason = parsed.error.issues[0]?.message ?? "Dados inválidos.";
    } else if ((input?.phone_number && phoneIdentityCandidates(input.phone_number)
      .some((phone) => seenPhones.has(phone))) ||
               (email && seenEmails.has(email))) {
      status = "duplicate_file";
      reason = "Contato repetido neste CSV.";
    }
    if (status === "valid") {
      if (input?.phone_number)
        for (const phone of phoneIdentityCandidates(input.phone_number)) seenPhones.add(phone);
      if (email) seenEmails.add(email);
    }
    return { row: position + 2, name, phone: input?.phone_number ?? (rawPhone || null),
      email, status, reason, input };
  });
}
