import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

const updateSchema = z.object({
  calendar_id: z.string().trim().min(1).max(300),
  timezone: z.string().trim().min(3).max(80),
  default_duration_minutes: z.number().int().min(5).max(1440),
  reminder_24h_enabled: z.boolean(),
  reminder_1h_enabled: z.boolean(),
  reminder_24h_template: z.string().trim().min(5).max(1500),
  reminder_1h_template: z.string().trim().min(5).max(1500),
});

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "calendar_settings" });
  if (!authz.ok) return authz.response;
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data, error } = await supabase
    .from("calendar_integrations")
    .select("id,google_account_email,status,calendar_id,calendar_name,timezone,default_duration_minutes,reminder_24h_enabled,reminder_1h_enabled,reminder_24h_template,reminder_1h_template,last_error,last_sync_at")
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (error) return fail("internal_error", "Não foi possível carregar a integração.", 500, { requestId });
  return ok(data, { requestId });
}

export async function PATCH(request: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "calendar_settings" });
  if (!authz.ok) return authz.response;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", parsed.error.issues[0]?.message ?? "Dados inválidos.", 422, { requestId });
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data, error } = await supabase
    .from("calendar_integrations")
    .update(parsed.data)
    .eq("organization_id", authz.org.orgId)
    .select("id,status")
    .maybeSingle();
  if (error || !data) return fail("not_found", "Conecte o Google Agenda antes de salvar.", 404, { requestId });
  return ok(data, { requestId });
}

export async function DELETE(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "calendar_settings" });
  if (!authz.ok) return authz.response;
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { error } = await supabase
    .from("calendar_integrations")
    .update({ status: "disconnected" })
    .eq("organization_id", authz.org.orgId);
  if (error) return fail("internal_error", "Não foi possível desconectar.", 500, { requestId });
  return ok({ disconnected: true }, { requestId });
}
