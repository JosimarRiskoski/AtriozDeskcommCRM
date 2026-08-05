import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { evolutionFriendlyError, getEvolutionClient } from "@/lib/evolution/client";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Migra a sessão técnica sem mexer nas conversas, contatos ou campanhas já ligados ao canal. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;
  const authz = await requireRole("admin", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;

  const evolution = getEvolutionClient();
  const webhookBase = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET || process.env.INTERNAL_SECRET;
  if (!evolution || !webhookBase || !webhookSecret) {
    return fail(
      "evolution_not_configured",
      "A Evolution ou o webhook seguro ainda não estão configurados.",
      503,
      { requestId },
    );
  }

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("channel_sessions")
    .select("id,provider,external_session_name,waha_session_name,webhook_path_token,status")
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!session) return fail("not_found", "Conexão não encontrada.", 404, { requestId });
  if (session.provider === "evolution")
    return ok({ id, migrated: false, status: session.status }, { requestId });
  if (!session.webhook_path_token) {
    return fail(
      "migration_unavailable",
      "Esta conexão antiga não possui token de webhook. Crie uma nova conexão pela Evolution.",
      409,
      { requestId },
    );
  }

  const instanceName = `evo_${session.waha_session_name}`.slice(0, 100);
  try {
    await evolution.createInstance({
      instanceName,
      webhookUrl: `${webhookBase}/api/v1/webhooks/evolution/${session.webhook_path_token}`,
      webhookHeaders: { "x-atrios-evolution-secret": webhookSecret },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (!message.includes("evolution_409")) {
      return fail("evolution_error", evolutionFriendlyError(message), 502, { requestId });
    }
  }

  const { error } = await supabase
    .from("channel_sessions")
    .update({
      provider: "evolution",
      external_session_name: instanceName,
      engine: "EVOLUTION",
      status: "STARTING",
      last_status_change_at: new Date().toISOString(),
      consecutive_health_fails: 0,
    })
    .eq("organization_id", authz.org.orgId)
    .eq("id", id);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  await audit({
    action: "channel.migrated_to_evolution",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
    metadata: { previous_provider: session.provider ?? "waha", instance_name: instanceName },
  });
  return ok({ id, migrated: true, status: "STARTING" }, { requestId });
}
