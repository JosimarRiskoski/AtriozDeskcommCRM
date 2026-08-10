/**
 * POST /api/v1/channel-sessions/[id]/reconnect — reconecta um canal caído.
 *
 * Reinicia a instância Evolution, reaplica o webhook seguro e gera novo QR
 * quando o WhatsApp exigir pareamento.
 *
 * Admin only. organization_id vem da sessão — nunca do path/body.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { evolutionFriendlyError, getEvolutionClient } from "@/lib/evolution/client";

export const dynamic = "force-dynamic";

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
  const { user, org: activeOrg } = authz;

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("channel_sessions")
    .select("id, provider, external_session_name, webhook_path_token, status")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!session) return fail("not_found", "Canal não encontrado.", 404, { requestId });

  const evolution = getEvolutionClient();
  if (session.provider === "evolution" && session.external_session_name) {
    if (!evolution) {
      return fail(
        "evolution_not_configured",
        "O serviÃ§o do WhatsApp (Evolution) nÃ£o estÃ¡ ativo. Suba o container e tente de novo.",
        503,
        { requestId },
      );
    }
    try {
      const instanceName = session.external_session_name;
      await evolution.restart(instanceName).catch(() => null);
      const webhookBase = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
      const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET || process.env.INTERNAL_SECRET;
      if (!webhookBase || !webhookSecret || !session.webhook_path_token) {
        return fail(
          "evolution_webhook_not_configured",
          "O webhook seguro da Evolution ainda não está configurado para esta conexão.",
          503,
          { requestId },
        );
      }
      await evolution.setWebhook(instanceName, {
        webhookUrl: `${webhookBase}/api/v1/webhooks/evolution/${session.webhook_path_token}`,
        webhookHeaders: { "x-atrios-evolution-secret": webhookSecret },
      });
      const remote = await evolution.connect(instanceName);
      await supabase
        .from("channel_sessions")
        .update({
          status: "STARTING",
          last_status_change_at: new Date().toISOString(),
          consecutive_health_fails: 0,
        })
        .eq("organization_id", activeOrg.orgId)
        .eq("id", id);
      void audit({
        action: "channel.reconnected",
        actorUserId: user.id,
        organizationId: activeOrg.orgId,
        resourceType: "channel_session",
        resourceId: id,
        requestId,
        metadata: { provider: "evolution", external_session_name: instanceName },
      });
      return ok({ id, status: remote.state }, { requestId });
    } catch (err) {
      return fail(
        "evolution_error",
        evolutionFriendlyError(err instanceof Error ? err.message : "unknown"),
        502,
        { requestId },
      );
    }
  }
  return fail(
    "unsupported_provider",
    "Esta conexão não usa a Evolution API. Crie uma nova conexão para continuar.",
    409,
    { requestId },
  );
}
