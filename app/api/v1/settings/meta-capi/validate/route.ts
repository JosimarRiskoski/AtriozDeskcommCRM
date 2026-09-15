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
    .select("dataset_id,graph_api_version,access_token_encrypted,test_event_code")
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (error || !setting)
    return fail("not_configured", "Salve a configuracao antes de validar.", 409, { requestId });
  const token = await decryptWebhookSecret(admin, setting.access_token_encrypted);
  if (!token)
    return fail("credential_unavailable", "Nao foi possivel ler o token salvo.", 409, {
      requestId,
    });
  if (!setting.test_event_code)
    return fail(
      "test_code_required",
      "Informe e salve o código de evento de teste da Meta antes de validar.",
      409,
      { requestId },
    );

  try {
    const response = await fetch(
      `https://graph.facebook.com/${setting.graph_api_version}/${encodeURIComponent(setting.dataset_id)}/events`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          test_event_code: setting.test_event_code,
          data: [
            {
              event_name: "TestEvent",
              event_time: Math.floor(Date.now() / 1000),
              event_id: `crm-meta-validation:${randomUUID()}`,
              action_source: "system_generated",
            },
          ],
        }),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      events_received?: number;
      error?: { message?: string; code?: number };
    };
    if (!response.ok || payload.error || !payload.events_received) {
      const code = payload.error?.code ?? response.status;
      const metaMessage = payload.error?.message?.replace(/\s+/g, " ").trim().slice(0, 500);
      const message =
        code === 190 || response.status === 401
          ? "O token da Meta e invalido ou expirou."
          : response.status === 403
            ? "O token nao possui acesso a este Dataset."
            : metaMessage
              ? `A Meta recusou o evento de teste: ${metaMessage}`
              : "A Meta nao confirmou este Dataset. Revise o ID e as permissoes do token.";
      return fail("meta_validation_failed", message, 422, {
        requestId,
        details: { meta_error_code: code },
      });
    }
    return ok(
      {
        valid: true,
        dataset_id: setting.dataset_id,
        dataset_name: null,
        test_event_sent: true,
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
