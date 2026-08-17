import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

export async function POST(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "meta_capi_settings" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: setting, error } = await admin
    .from("meta_capi_settings")
    .select("dataset_id,graph_api_version,access_token_encrypted")
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (error || !setting)
    return fail("not_configured", "Salve a configuracao antes de validar.", 409, { requestId });
  const token = await decryptWebhookSecret(admin, setting.access_token_encrypted);
  if (!token)
    return fail("credential_unavailable", "Nao foi possivel ler o token salvo.", 409, {
      requestId,
    });

  try {
    const response = await fetch(
      `https://graph.facebook.com/${setting.graph_api_version}/${encodeURIComponent(setting.dataset_id)}?fields=id,name`,
      { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      id?: string;
      name?: string;
      error?: { message?: string; code?: number };
    };
    if (!response.ok || payload.error) {
      const code = payload.error?.code ?? response.status;
      const message =
        code === 190 || response.status === 401
          ? "O token da Meta e invalido ou expirou."
          : response.status === 403
            ? "O token nao possui acesso a este Dataset."
            : "A Meta nao confirmou este Dataset. Revise o ID e as permissoes do token.";
      return fail("meta_validation_failed", message, 422, { requestId });
    }
    return ok(
      {
        valid: true,
        dataset_id: payload.id ?? setting.dataset_id,
        dataset_name: payload.name ?? null,
      },
      { requestId },
    );
  } catch {
    return fail(
      "meta_unreachable",
      "Nao foi possivel consultar a Meta agora. Tente novamente.",
      503,
      { requestId },
    );
  }
}
