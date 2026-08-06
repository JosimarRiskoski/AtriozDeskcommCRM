import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { aiAutomationSchema } from "@/lib/schemas/settings";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DEFAULT_AUTOMATION = { enabled_for_all: false };

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  // Todo atendente precisa ler o estado para o Inbox exibir a mecânica correta;
  // somente administradores continuam autorizados a alterar a chave geral.
  const authz = await requireRole("agent", { requestId, resource: "settings_ai_automation" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", authz.org.orgId)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const settings = (data?.settings as Record<string, unknown> | null) ?? {};
  return ok(aiAutomationSchema.catch(DEFAULT_AUTOMATION).parse(settings.ai_automation ?? {}), {
    requestId,
  });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "settings_ai_automation" });
  if (!authz.ok) return authz.response;
  const parsed = aiAutomationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return fail("validation_failed", "Configuração de IA inválida.", 422, { requestId });

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", authz.org.orgId)
    .maybeSingle();
  if (readError) return fail("internal_error", readError.message, 500, { requestId });

  const settings = (current?.settings as Record<string, unknown> | null) ?? {};
  const { error: updateError } = await supabase
    .from("organizations")
    .update({ settings: { ...settings, ai_automation: parsed.data } })
    .eq("id", authz.org.orgId);
  if (updateError) return fail("internal_error", updateError.message, 500, { requestId });

  await audit({
    action: "ai.automation_config_changed",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "organization",
    resourceId: authz.org.orgId,
    requestId,
    metadata: parsed.data,
  });
  return ok(parsed.data, { requestId });
}
