import { createSign } from "node:crypto";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const MAX_ROWS = 2_001;
const MAX_COLUMNS = 26;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export function extractSpreadsheetId(value: string): string {
  const input = value.trim();
  const urlMatch = input.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  const id = urlMatch?.[1] ?? input;
  if (!/^[a-zA-Z0-9_-]{20,}$/.test(id)) throw new Error("invalid_spreadsheet");
  return id;
}

export function rowsToCsv(rows: unknown[][]): string {
  if (rows.length > MAX_ROWS) throw new Error("sheet_too_many_rows");
  const csv = rows
    .map((row) =>
      row
        .slice(0, MAX_COLUMNS)
        .map((cell) => {
          const value = String(cell ?? "").replace(/\r?\n/g, " ");
          return `"${value.replace(/"/g, '""')}"`;
        })
        .join(","),
    )
    .join("\n");
  if (Buffer.byteLength(csv, "utf8") > MAX_TEXT_BYTES) throw new Error("sheet_too_large");
  return csv;
}

async function getAccessToken(): Promise<string> {
  const email = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!email || !privateKey) throw new Error("sheets_not_configured");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iss: email, scope: SHEETS_SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  );
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(privateKey).toString("base64url")}`;
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });
  const json = (await response.json()) as { access_token?: string };
  if (!response.ok || !json.access_token) throw new Error("sheets_auth_failed");
  return json.access_token;
}

export async function fetchGoogleSheetCsv(
  spreadsheet: string,
  range = "A:Z",
): Promise<{ csv: string; spreadsheetId: string; range: string }> {
  const spreadsheetId = extractSpreadsheetId(spreadsheet);
  const cleanRange = range.trim() || "A:Z";
  if (cleanRange.length > 160 || /[\r\n]/.test(cleanRange)) throw new Error("invalid_sheet_range");
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(cleanRange)}?majorDimension=ROWS`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const json = (await response.json()) as { values?: unknown[][] };
  if (!response.ok) {
    if (response.status === 403 || response.status === 404) throw new Error("sheet_not_shared");
    throw new Error("sheet_fetch_failed");
  }
  const rows = Array.isArray(json.values) ? json.values : [];
  if (rows.length < 2) throw new Error("sheet_empty");
  return { csv: rowsToCsv(rows), spreadsheetId, range: cleanRange };
}

export function googleSheetErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "sheet_fetch_failed";
  const messages: Record<string, string> = {
    invalid_spreadsheet: "Informe um link ou ID válido do Google Sheets.",
    invalid_sheet_range: "Informe uma aba ou intervalo válido, como Leads!A:Z.",
    sheets_not_configured: "Google Sheets ainda não está configurado no servidor.",
    sheets_auth_failed: "A credencial do Google Sheets foi recusada.",
    sheet_not_shared:
      "A planilha não foi encontrada ou não foi compartilhada com a conta de serviço.",
    sheet_empty: "A planilha precisa ter cabeçalho e pelo menos um contato.",
    sheet_too_many_rows: "A planilha deve ter no máximo 2.000 contatos por campanha.",
    sheet_too_large: "A planilha excede o limite de 2 MB.",
  };
  return messages[code] ?? "Não foi possível ler a planilha do Google Sheets.";
}
