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
      const previousInstanceName = session.external_session_name;
      let instanceName = previousInstanceName;
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
      const webhook = {
        webhookUrl: `${webhookBase}/api/v1/webhooks/evolution/${session.webhook_path_token}`,
        webhookHeaders: { "x-atrios-evolution-secret": webhookSecret },
      };

      // "Reconectar" é uma ação explícita do administrador. A Evolution 2.3.x
      // pode manter uma instância como `open` mesmo com o socket Baileys morto;
      // restart/connectionState então devolvem falso sucesso. Recriar somente a
      // instância técnica garante um QR novo sem apagar o histórico do CRM.
      try {
        await evolution.deleteInstance(instanceName);
      } catch (deleteError) {
        const deleteMessage =
          deleteError instanceof Error ? deleteError.message : String(deleteError);
        if (!/evolution_404/i.test(deleteMessage)) {
          // Algumas sessoes Baileys corrompidas ficam presas no banco da
          // Evolution e o proprio endpoint de exclusao responde 400. Nesse
          // caso, abandonar apenas o identificador tecnico antigo e criar uma
          // instancia nova e mais seguro do que manter o CRM falsamente
          // conectado. O historico permanece no banco do CRM.
          instanceName = `${previousInstanceName}_r_${randomUUID().slice(0, 8)}`;
          console.warn("[channel.reconnect] Replacing corrupted Evolution instance", {
            request_id: requestId,
            channel_session_id: id,
            previous_instance_name: previousInstanceName,
            replacement_instance_name: instanceName,
            provider_error: deleteMessage.slice(0, 500),
          });
        }
      }
      // `instance/create` com `qrcode: true` ja inicia o pareamento e devolve
      // o QR. Chamar `instance/connect` imediatamente outra vez faz a
      // Evolution 2.3.x rejeitar a requisicao com HTTP 400 porque a mesma
      // instancia ja esta em `connecting`.
      const created = await evolution.createInstance({ instanceName, ...webhook });
      const remote = created.qrcode ? created : await evolution.connect(instanceName);
      await supabase
        .from("channel_sessions")
        .update({
          external_session_name: instanceName,
          status: "STARTING",
          status_reason: "Escaneie o novo QR Code para reconectar esta sessão.",
          last_status_change_at: new Date().toISOString(),
          last_health_check_at: new Date().toISOString(),
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
        metadata: {
          provider: "evolution",
          external_session_name: instanceName,
          previous_external_session_name: previousInstanceName,
          rebuilt: true,
        },
      });
      return ok({ id, status: remote.state, qrcode: remote.qrcode, rebuilt: true }, { requestId });
    } catch (err) {
      const providerMessage = err instanceof Error ? err.message : "unknown";
      console.error("[channel.reconnect] Evolution recovery failed", {
        request_id: requestId,
        channel_session_id: id,
        provider_error: providerMessage.slice(0, 500),
      });
      await supabase
        .from("channel_sessions")
        .update({
          status: "FAILED",
          status_reason: "A sessão do WhatsApp não pôde ser recuperada. Tente reconectar novamente.",
          last_status_change_at: new Date().toISOString(),
          last_health_check_at: new Date().toISOString(),
        })
        .eq("organization_id", activeOrg.orgId)
        .eq("id", id);
      return fail(
        "evolution_error",
        evolutionFriendlyError(providerMessage),
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
