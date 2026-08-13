/**
 * GET /api/v1/channel-sessions/[id] — health check AO VIVO de um canal.
 *
 * Consulta o status real na Evolution, grava `last_health_check_at` (+ sincroniza
 * `status`) no DB e devolve o estado atual. É a fonte de verdade quando o
 * usuário abre a Central de Conexões ou está aguardando o QR ser escaneado.
 *
 * Qualquer membro da org pode consultar. organization_id vem da sessão.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { isChannelStatus, updateChannelSchema } from "@/lib/schemas/channels";
import { createClient } from "@/lib/supabase/server";
import { evolutionFriendlyError, getEvolutionClient } from "@/lib/evolution/client";

export const dynamic = "force-dynamic";

async function loadDependencies(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  sessionId: string,
) {
  const [conversations, agents, campaigns, recipients, assignmentRules, webhookSources] =
    await Promise.all([
      supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("channel_session_id", sessionId),
      supabase
        .from("ai_agent_versions")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("channel_session_id", sessionId),
      supabase
        .from("outreach_campaigns")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("channel_session_id", sessionId),
      supabase
        .from("outreach_campaign_recipients")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("channel_session_id", sessionId),
      supabase
        .from("ai_agent_assignment_rules")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("channel_session_id", sessionId),
      supabase
        .from("webhook_sources")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("default_channel_session_id", sessionId),
    ]);
  return {
    conversas: conversations.count ?? 0,
    agentes: agents.count ?? 0,
    campanhas: campaigns.count ?? 0,
    destinatarios_de_campanha: recipients.count ?? 0,
    regras_de_agente: assignmentRules.count ?? 0,
    integracoes: webhookSources.count ?? 0,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;

  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return fail("forbidden_tenant", "Nenhuma organização ativa.", 403, { requestId });

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("channel_sessions")
    .select(
      "id, provider, external_session_name, display_name, display_color, phone_number, status",
    )
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!session) return fail("not_found", "Canal não encontrado.", 404, { requestId });

  if (req.nextUrl.searchParams.get("dependencies") === "1") {
    const dependencies = await loadDependencies(supabase, activeOrg.orgId, id);
    return ok({ session, dependencies }, { requestId });
  }

  const provider = session.provider;
  const evolution = getEvolutionClient();
  if (provider !== "evolution" || !session.external_session_name) {
    return ok({ ...session, provider_configured: false }, { requestId });
  }
  if (!evolution) {
    return ok({ ...session, provider_configured: false }, { requestId });
  }

  let liveStatus = session.status as string;
  let phoneNumber = session.phone_number as string | null;
  try {
    if (evolution) {
      const remote = await evolution.connectionState(session.external_session_name);
      const state = remote.state.toLowerCase();
      liveStatus =
        state === "open" ? "WORKING" : state === "connecting" ? "STARTING" : "SCAN_QR_CODE";
      const identity = remote.number || remote.ownerJid;
      if (identity && !phoneNumber) phoneNumber = identity.replace(/@.*/, "");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    // 404 = instância não existe mais na Evolution.
    if (msg.includes("404")) liveStatus = "STOPPED";
    // outros erros: mantém o status do DB (não sobrescreve com ruído transitório).
  }

  // Sincroniza o DB: sempre carimba o health check; atualiza status/telefone só se válido.
  const patch: Record<string, unknown> = { last_health_check_at: new Date().toISOString() };
  if (isChannelStatus(liveStatus) && liveStatus !== session.status) {
    patch.status = liveStatus;
    patch.last_status_change_at = new Date().toISOString();
  }
  if (phoneNumber && phoneNumber !== session.phone_number) patch.phone_number = phoneNumber;
  await supabase
    .from("channel_sessions")
    .update(patch)
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id);

  return ok(
    {
      id: session.id,
      provider,
      external_session_name: session.external_session_name,
      display_name: session.display_name,
      phone_number: phoneNumber,
      status: liveStatus,
      last_health_check_at: patch.last_health_check_at,
      provider_configured: true,
    },
    { requestId },
  );
}

export async function PATCH(
  req: NextRequest,
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

  const parsed = updateChannelSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return fail("validation_failed", "Dados da conexão inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors,
    });

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("channel_sessions")
    .select("id,display_name,display_color,is_default,archived_at,status")
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!session) return fail("not_found", "Conexão não encontrada.", 404, { requestId });

  let patch: Record<string, unknown>;
  let action: "channel.updated" | "channel.archived" | "channel.restored";
  if (parsed.data.action === "update") {
    if (parsed.data.is_default) {
      await supabase
        .from("channel_sessions")
        .update({ is_default: false })
        .eq("organization_id", authz.org.orgId)
        .eq("is_default", true)
        .neq("id", id);
    }
    patch = {
      display_name: parsed.data.display_name,
      purpose: parsed.data.purpose || null,
      ...(parsed.data.display_color === undefined
        ? {}
        : { display_color: parsed.data.display_color }),
      ...(parsed.data.is_default === undefined ? {} : { is_default: parsed.data.is_default }),
      updated_at: new Date().toISOString(),
    };
    action = "channel.updated";
  } else if (parsed.data.action === "archive") {
    if (!["FAILED", "STOPPED"].includes(session.status))
      return fail("conflict", "Desconecte a conexão antes de arquivá-la.", 409, { requestId });
    if (session.is_default)
      return fail(
        "conflict",
        "Defina outra conexão como padrão antes de arquivar esta conexão.",
        409,
        { requestId },
      );
    patch = {
      archived_at: new Date().toISOString(),
      archived_by_user_id: authz.user.id,
      archive_reason: parsed.data.reason,
      is_default: false,
      updated_at: new Date().toISOString(),
    };
    action = "channel.archived";
  } else {
    patch = {
      archived_at: null,
      archived_by_user_id: null,
      archive_reason: null,
      updated_at: new Date().toISOString(),
    };
    action = "channel.restored";
  }

  const { data: updated, error } = await supabase
    .from("channel_sessions")
    .update(patch)
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .select("id,display_name,display_color,phone_number,purpose,is_default,archived_at,status")
    .single();
  if (error)
    return fail("internal_error", "Não foi possível atualizar a conexão.", 500, { requestId });

  await audit({
    action,
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
    metadata: { previous_name: session.display_name, ...parsed.data },
  });
  return ok(updated, { requestId });
}

export async function DELETE(
  req: NextRequest,
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

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("channel_sessions")
    .select("id,provider,external_session_name,display_name,phone_number,status,is_default")
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!session) return fail("not_found", "Conexão não encontrada.", 404, { requestId });

  const confirmation = decodeURIComponent(req.headers.get("x-confirm-connection-name") ?? "");
  const reason = decodeURIComponent(req.headers.get("x-deletion-reason") ?? "").trim();
  if (confirmation !== session.display_name || reason.length < 3) {
    return fail(
      "confirmation_required",
      "Digite exatamente o nome da conexão e informe o motivo da exclusão.",
      422,
      { requestId },
    );
  }
  if (session.is_default)
    return fail(
      "conflict",
      "Defina outra conexão como padrão antes de excluir esta conexão.",
      409,
      { requestId },
    );

  if (!["FAILED", "STOPPED"].includes(session.status)) {
    return fail(
      "conflict",
      "Desconecte a conexão antes de excluí-la. Conexões ativas não podem ser apagadas.",
      409,
      { requestId },
    );
  }

  const dependencies = await loadDependencies(supabase, authz.org.orgId, id);
  if (Object.values(dependencies).some((count) => count > 0)) {
    return fail(
      "conflict",
      `Esta conexão possui histórico ou configurações vinculadas (${dependencies.conversas} conversas, ${dependencies.agentes} agentes e ${dependencies.campanhas} campanhas). Reatribua essas dependências antes de excluir.`,
      409,
      { requestId, details: dependencies },
    );
  }

  const evolution = getEvolutionClient();
  if (session.provider !== "evolution" || !session.external_session_name) {
    return fail("unsupported_provider", "Esta conexão não usa a Evolution API.", 409, {
      requestId,
    });
  }
  if (!evolution) {
    return fail("evolution_not_configured", "A Evolution nÃ£o estÃ¡ configurada.", 503, {
      requestId,
    });
  }
  if (evolution) {
    try {
      await evolution.deleteInstance(session.external_session_name);
    } catch (error) {
      return fail(
        "provider_error",
        error instanceof Error
          ? evolutionFriendlyError(error.message)
          : "Falha ao excluir a conexÃ£o.",
        502,
        { requestId },
      );
    }
  }

  const { error } = await supabase
    .from("channel_sessions")
    .delete()
    .eq("organization_id", authz.org.orgId)
    .eq("id", id);
  if (error)
    return fail("internal_error", "Não foi possível excluir a conexão.", 500, { requestId });

  await audit({
    action: "channel.deleted",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
    metadata: {
      display_name: session.display_name,
      phone_number: session.phone_number,
      provider: session.provider,
      external_session_name: session.external_session_name,
      reason,
    },
  });

  return ok({ id, deleted: true }, { requestId });
}
