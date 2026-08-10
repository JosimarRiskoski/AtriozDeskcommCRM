import { NextResponse } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { env } from "@/lib/env";
import { getEvolutionClient } from "@/lib/evolution/client";
import { createClient } from "@/lib/supabase/server";

function defaultSessionName(orgId: string): string {
  return `org_${orgId.slice(0, 8)}`;
}

async function ensureChannelSession(orgId: string, sessionName: string) {
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("channel_sessions")
    .select("id,webhook_path_token")
    .eq("organization_id", orgId)
    .eq("external_session_name", sessionName)
    .maybeSingle();
  if (existing?.id && existing.webhook_path_token)
    return { id: existing.id, token: existing.webhook_path_token };

  const token = crypto.randomUUID().replace(/-/g, "");
  const { data: created, error } = await supabase
    .from("channel_sessions")
    .insert({
      organization_id: orgId,
      provider: "evolution",
      external_session_name: sessionName,
      engine: "EVOLUTION",
      webhook_path_token: token,
      webhook_secret_encrypted: Buffer.from([0]),
      status: "STARTING",
      last_status_change_at: new Date().toISOString(),
      consecutive_health_fails: 0,
      daily_message_limit: 250,
      metadata: {},
    })
    .select("id")
    .single();
  if (error || !created)
    throw new Error(`channel_session_insert_failed: ${error?.message ?? "unknown"}`);
  return { id: created.id, token };
}

export async function GET() {
  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Sessão expirada", 401);
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return fail("tenant_not_found", "Sem organização ativa", 404);
  const evolution = getEvolutionClient();
  if (!evolution) return ok({ status: "EVOLUTION_NOT_CONFIGURED", session: null });
  const sessionName = defaultSessionName(activeOrg.orgId);
  try {
    const remote = await evolution.connectionState(sessionName);
    return ok({ status: remote.state === "open" ? "WORKING" : remote.state, session: sessionName });
  } catch {
    return ok({ status: "NOT_STARTED", session: sessionName });
  }
}

export async function POST() {
  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Sessão expirada", 401);
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return fail("tenant_not_found", "Sem organização ativa", 404);
  const evolution = getEvolutionClient();
  const webhookBase = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET || process.env.INTERNAL_SECRET;
  if (!evolution || !webhookBase || !webhookSecret)
    return fail(
      "evolution_not_configured",
      "Configure a Evolution e o webhook seguro antes de continuar.",
      503,
    );

  const sessionName = defaultSessionName(activeOrg.orgId);
  const channel = await ensureChannelSession(activeOrg.orgId, sessionName);
  try {
    const remote = await evolution.createInstance({
      instanceName: sessionName,
      webhookUrl: `${webhookBase}/api/v1/webhooks/evolution/${channel.token}`,
      webhookHeaders: { "x-atrios-evolution-secret": webhookSecret },
    });
    return ok({ status: remote.state, session: sessionName, channel_session_id: channel.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message.includes("evolution_409")) {
      const remote = await evolution.connect(sessionName);
      return ok({ status: remote.state, session: sessionName, channel_session_id: channel.id });
    }
    return NextResponse.json(
      { error: { code: "evolution_start_failed", message } },
      { status: 502 },
    );
  }
}
