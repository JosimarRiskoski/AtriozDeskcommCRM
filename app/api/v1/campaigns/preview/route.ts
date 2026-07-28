import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { fail, ok } from "@/lib/api/wrappers";
import { previewCampaignCsv } from "@/lib/campaigns/csv";
import { fetchGoogleSheetCsv, googleSheetErrorMessage } from "@/lib/campaigns/google-sheets";

export const dynamic = "force-dynamic";
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "outreach_campaigns" });
  if (!authz.ok) return authz.response;
  const form = await req.formData();
  const source = form.get("source") === "google_sheets" ? "google_sheets" : "csv";
  const file = form.get("file");
  if (source === "csv" && (!(file instanceof File) || !file.name.toLowerCase().endsWith(".csv"))) {
    return fail("validation_failed", "Envie um arquivo CSV.", 422, { requestId });
  }
  if (source === "csv" && file instanceof File && file.size > MAX_FILE_BYTES) {
    return fail("validation_failed", "O CSV deve ter no máximo 2 MB.", 422, { requestId });
  }
  try {
    const text =
      source === "google_sheets"
        ? (
            await fetchGoogleSheetCsv(
              String(form.get("spreadsheet") ?? ""),
              String(form.get("range") ?? "A:Z"),
            )
          ).csv
        : await (file as File).text();
    const rows = previewCampaignCsv(text);
    const counts = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {});
    return ok(
      { rows, counts, total: rows.length, truncated: rows.length === 2_000 },
      { requestId },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "missing_phone_column") {
      return fail(
        "validation_failed",
        "A lista precisa ter uma coluna telefone, celular ou WhatsApp.",
        422,
        { requestId },
      );
    }
    return fail(
      "validation_failed",
      source === "google_sheets"
        ? googleSheetErrorMessage(error)
        : "Não foi possível interpretar o CSV.",
      422,
      { requestId },
    );
  }
}
