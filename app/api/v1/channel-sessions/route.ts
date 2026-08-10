/**
 * GET  /api/v1/channel-sessions — lista os canais WhatsApp da org (do DB).
 *   Acessível a qualquer membro (usado pelo seletor do inbox e pela sidebar).
 * POST /api/v1/channel-sessions — conecta um NOVO número (cria a sessão com
 *   nome único e inicia na Evolution). Admin only.
 *
 * organization_id resolvido da sessão (cookie) — nunca do body.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { env } from "@/lib/env";
import { createChannelSchema } from "@/lib/schemas/channels";
import { createClient } from "@/lib/supabase/server";
import { evolutionFriendlyError, getEvolutionClient } from "@/lib/evolution/client";

export const dynamic = "force-dynamic";

export const CHANNEL_COLUMNS =
  "id, provider, external_session_name, display_name, phone_number, purpose, is_default, archived_at, status, status_reason, last_health_check_at, last_inbound_event_at, last_outbound_event_at, last_status_change_at, daily_message_limit, is_warmup_complete, created_at";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return fail("forbidden_tenant", "Nenhuma organização ativa.", 403, { requestId });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("channel_sessions")
    .select(CHANNEL_COLUMNS)
    .eq("organization_id", activeOrg.orgId)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const { data: conversations } = await supabase
    .from("conversations")
    .select("channel_session_id,last_inbound_at,last_outbound_at")
    .eq("organization_id", activeOrg.orgId);

  const activity = new Map<
    string,
    { last_inbound_at: string | null; last_outbound_at: string | null }
  >();
  for (const conversation of conversations ?? []) {
    const current = activity.get(conversation.channel_session_id) ?? {
      last_inbound_at: null,
      last_outbound_at: null,
    };
    if (
      conversation.last_inbound_at &&
      (!current.last_inbound_at || conversation.last_inbound_at > current.last_inbound_at)
    ) {
      current.last_inbound_at = conversation.last_inbound_at;
    }
    if (
      conversation.last_outbound_at &&
      (!current.last_outbound_at || conversation.last_outbound_at > current.last_outbound_at)
    ) {
      current.last_outbound_at = conversation.last_outbound_at;
    }
    activity.set(conversation.channel_session_id, current);
  }

  return ok(
    (data ?? []).map((session) => ({
      ...session,
      last_inbound_at: activity.get(session.id)?.last_inbound_at ?? null,
      last_outbound_at: activity.get(session.id)?.last_outbound_at ?? null,
    })),
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  const evolution = getEvolutionClient();
  if (!evolution) {
    return fail(
      "evolution_not_configured",
      "O serviço do WhatsApp (Evolution) não está ativo. Suba o container e tente de novo.",
      503,
      { requestId },
    );
  }

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = createChannelSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const supabase = await createClient();
  if (parsed.data.is_default) {
    await supabase
      .from("channel_sessions")
      .update({ is_default: false })
      .eq("organization_id", activeOrg.orgId)
      .eq("is_default", true);
  }
  // Nome de sessão único por canal — o hardcode `org_<8>` era 1 número por org.
  const sessionName = `org_${activeOrg.orgId.slice(0, 8)}_${randomUUID().replace(/-/g, "").slice(0, 6)}`;
  const webhookToken = randomUUID().replace(/-/g, "");
  // `NEXT_PUBLIC_*` é substituída pelo Next durante o build da imagem. A
  // imagem self-hosted é genérica, então a URL real precisa vir do parser de
  // ambiente em runtime; caso contrário a Evolution recebe placeholder.invalid.
  const webhookBase = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET || process.env.INTERNAL_SECRET;
  if (!webhookBase || !webhookSecret) {
    return fail("evolution_not_configured", "A URL pública do CRM não está configurada.", 503, {
      requestId,
    });
  }

  const { data: created, error: insErr } = await supabase
    .from("channel_sessions")
    .insert({
      organization_id: activeOrg.orgId,
      provider: "evolution",
      external_session_name: sessionName,
      display_name: parsed.data.display_name,
      purpose: parsed.data.purpose ?? null,
      is_default: parsed.data.is_default,
      engine: "EVOLUTION",
      webhook_path_token: webhookToken,
      webhook_secret_encrypted: Buffer.from([0]),
      status: "STARTING",
      last_status_change_at: new Date().toISOString(),
      consecutive_health_fails: 0,
      daily_message_limit: 250,
      metadata: {},
    })
    .select(CHANNEL_COLUMNS)
    .single();
  if (insErr || !created) {
    return fail("internal_error", insErr?.message ?? "channel_session_insert_failed", 500, {
      requestId,
    });
  }

  try {
    await evolution.createInstance({
      instanceName: sessionName,
      webhookUrl: `${webhookBase}/api/v1/webhooks/evolution/${webhookToken}`,
      webhookHeaders: { "x-atrios-evolution-secret": webhookSecret },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    // Rollback: sem Evolution no ar, não deixamos um canal fantasma preso em STARTING.
    await supabase
      .from("channel_sessions")
      .delete()
      .eq("organization_id", activeOrg.orgId)
      .eq("id", created.id);
    return fail("evolution_error", evolutionFriendlyError(msg), 502, { requestId });
  }

  void audit({
    action: "channel.connected",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "channel_session",
    resourceId: created.id,
    requestId,
    metadata: { provider: "evolution", external_session_name: sessionName },
  });

  return ok(created, { requestId, status: 201 });
}
