import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { findActiveContactByPhone } from "@/lib/contacts/find-by-phone";
import { createContactHandler } from "@/app/api/v1/contacts/_handler";
import { MAX_CONTACT_IMPORT_BYTES, parseContactImportCsv, type ContactImportRow } from "@/lib/contacts/import-csv";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const action = form?.get("action");
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_CONTACT_IMPORT_BYTES ||
      !["preview", "import"].includes(String(action)))
    return fail("validation_failed", "Envie um CSV de até 2 MB e escolha uma ação válida.", 422, { requestId });
  let rows: ContactImportRow[];
  try {
    rows = parseContactImportCsv(await file.text());
  } catch (error) {
    return fail("validation_failed", error instanceof Error ? error.message : "CSV inválido.", 422, { requestId });
  }
  const supabase = await createClient();
  const orgId = authz.org.orgId;
  if (action === "preview") {
    for (let start = 0; start < rows.length; start += 10) {
      await Promise.all(rows.slice(start, start + 10).map(async (row) => {
        if (row.status !== "valid" || !row.input) return;
        try {
          if (row.input.phone_number) {
            const identity = await findActiveContactByPhone(supabase, orgId, row.input.phone_number);
            if (identity.kind !== "not_found") {
              row.status = "existing";
              row.reason = identity.kind === "ambiguous"
                ? "Telefone ambíguo: revisar antes de cadastrar." : "Telefone já cadastrado.";
              return;
            }
          }
          if (row.email) {
            const { data, error } = await supabase.from("contacts").select("id")
              .eq("organization_id", orgId).eq("email_normalized", row.email)
              .is("is_merged_into", null).limit(1);
            if (error) throw error;
            if (data?.length) {
              row.status = "existing";
              row.reason = "Email já cadastrado.";
            }
          }
        } catch {
          row.status = "invalid";
          row.reason = "Não foi possível verificar duplicidade. Tente novamente.";
        }
      }));
    }
    return ok({ rows: rows.map(({ input: _input, ...row }) => row),
      total: rows.length,
      ready: rows.filter((row) => row.status === "valid").length }, { requestId });
  }

  const results: Array<{ row: number; status: "created" | "existing" | "invalid" | "error"; reason: string | null }> = [];
  for (const row of rows) {
    if (row.status !== "valid" || !row.input) {
      results.push({ row: row.row, status: row.status === "duplicate_file" ? "existing" : "invalid", reason: row.reason });
      continue;
    }
    try {
      const result = await createContactHandler(supabase, {
        organization_id: orgId,
        actor: { type: "user", id: authz.user.id },
        requestId,
      }, { ...row.input, source_metadata: {
        import_filename: file.name.slice(0, 120), import_row: row.row,
      } });
      results.push({ row: row.row, status: result.action, reason: result.action === "existing" ? "Já cadastrado." : null });
    } catch (error) {
      const ambiguous = error instanceof ApiError && error.status === 409;
      if (!ambiguous) console.error("[contacts.import] create failed", { requestId, row: row.row, error });
      results.push({ row: row.row, status: ambiguous ? "existing" : "error",
        reason: ambiguous ? "Telefone ambíguo: revisar manualmente." : "Falha ao cadastrar. Tente novamente." });
    }
  }
  return ok({ total: results.length,
    created: results.filter((item) => item.status === "created").length,
    existing: results.filter((item) => item.status === "existing").length,
    invalid: results.filter((item) => item.status === "invalid").length,
    errors: results.filter((item) => item.status === "error").length,
    rows: results }, { requestId });
}
