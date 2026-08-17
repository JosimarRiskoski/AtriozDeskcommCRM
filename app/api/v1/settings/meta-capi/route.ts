import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth/require-role";
import { fail, ok } from "@/lib/api/wrappers";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

const schema = z.object({
  dataset_id: z.string().trim().min(3).max(100),
  access_token: z.string().min(20).max(1000).optional(),
  graph_api_version: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default("v25.0"),
  event_name: z.string().trim().min(1).max(80).default("Purchase"),
  conversion_label: z.string().trim().min(2).max(100).default("Venda fechada"),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("BRL"),
  test_event_code: z.string().trim().max(100).nullish(),
  require_consent: z.boolean().default(true),
  enabled: z.boolean().default(false),
});

export async function GET() {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "meta_capi_settings" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient() as unknown as SupabaseClient;
  const [{ data, error }, { data: deliveries }] = await Promise.all([
    admin
      .from("meta_capi_settings")
      .select(
        "organization_id,dataset_id,graph_api_version,event_name,conversion_label,currency,test_event_code,require_consent,enabled,updated_at",
      )
      .eq("organization_id", authz.org.orgId)
      .maybeSingle(),
    admin
      .from("meta_conversion_events")
      .select("status,sent_at,last_error,requested_at")
      .eq("organization_id", authz.org.orgId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  if (error) return fail("internal_error", "Falha ao ler configuração Meta.", 500, { requestId });
  const summary = {
    sent: (deliveries ?? []).filter((item) => item.status === "sent").length,
    failed: (deliveries ?? []).filter((item) => item.status === "failed").length,
    last: (deliveries ?? [])[0] ?? null,
  };
  return ok(data ? { ...data, delivery_summary: summary } : null, { requestId });
}
export async function PUT(req: NextRequest) {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "meta_capi_settings" });
  if (!authz.ok) return authz.response;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return fail("validation_failed", "Configuração Meta inválida.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors,
    });
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: existing } = await admin
    .from("meta_capi_settings")
    .select("access_token_encrypted")
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  let encrypted = existing?.access_token_encrypted as string | undefined;
  if (parsed.data.access_token) {
    encrypted = (await encryptWebhookSecret(admin, parsed.data.access_token)) ?? undefined;
  }
  if (!encrypted)
    return fail("encryption_unavailable", "Informe o token e configure a chave de cifra.", 422, {
      requestId,
    });
  const { access_token: _drop, ...safe } = parsed.data;
  const { data, error } = await admin
    .from("meta_capi_settings")
    .upsert({
      organization_id: authz.org.orgId,
      ...safe,
      access_token_encrypted: encrypted,
      updated_at: new Date().toISOString(),
    })
    .select(
      "organization_id,dataset_id,graph_api_version,event_name,conversion_label,currency,test_event_code,require_consent,enabled,updated_at",
    )
    .single();
  if (error)
    return fail("internal_error", "Falha ao salvar configuração Meta.", 500, { requestId });
  return ok(data, { requestId });
}
