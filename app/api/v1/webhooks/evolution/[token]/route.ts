/** Recebe eventos da Evolution API por conexão e os persiste antes de disparar a IA. */
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  dispatchEvolutionEvent,
  type EvolutionSession,
  type EvolutionWebhookEnvelope,
} from "@/lib/evolution/ingest";
import { compactEvolutionWebhookLog } from "@/lib/evolution/webhook-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ token: string }>;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const requestId = randomUUID();
  const { token } = await ctx.params;
  if (!token || token.length < 8)
    return fail("not_found", "unknown webhook token", 404, { requestId });
  const expectedSecret = process.env.EVOLUTION_WEBHOOK_SECRET || process.env.INTERNAL_SECRET;
  if (!expectedSecret || req.headers.get("x-atrios-evolution-secret") !== expectedSecret) {
    return fail("unauthenticated", "invalid webhook secret", 401, { requestId });
  }

  const rawBody = await req.text();
  let envelope: EvolutionWebhookEnvelope;
  try {
    envelope = JSON.parse(rawBody) as EvolutionWebhookEnvelope;
  } catch {
    return fail("invalid_request", "invalid_json", 400, { requestId });
  }

  const admin = createAdminClient();
  const { data: session, error: sessionError } = await admin
    .from("channel_sessions")
    .select(
      "id,organization_id,provider,external_session_name,waha_session_name,is_warmup_complete,warmup_started_at",
    )
    .eq("webhook_path_token", token)
    .eq("provider", "evolution")
    .maybeSingle();
  if (sessionError) return fail("internal_error", sessionError.message, 500, { requestId });
  if (!session) return fail("not_found", "unknown evolution webhook token", 404, { requestId });

  const instanceName = String(envelope.instance ?? envelope.instanceName ?? "");
  if (instanceName && instanceName !== session.external_session_name) {
    return fail("unauthenticated", "unexpected_instance", 401, { requestId });
  }

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    if (!/authorization|cookie|apikey/i.test(key)) headers[key] = value;
  });
  const data = Array.isArray(envelope.data) ? envelope.data[0] : envelope.data;
  const key =
    data && typeof data === "object" ? (data as { key?: { id?: string } }).key : undefined;
  const compactLog = compactEvolutionWebhookLog(envelope, rawBody);
  const { data: logged } = await admin
    .from("webhook_events_log")
    .insert({
      organization_id: session.organization_id,
      channel_session_id: session.id,
      provider: "evolution",
      webhook_path_token: token,
      http_method: "POST",
      headers,
      raw_body: compactLog.rawBody,
      payload_parsed: compactLog.payloadParsed,
      valid_signature: true,
      event_type: String(envelope.event ?? "unknown"),
      external_id: key?.id ?? null,
      status: "received",
      attempts: 0,
    })
    .select("id")
    .maybeSingle();

  try {
    await dispatchEvolutionEvent(admin, session as EvolutionSession, envelope, requestId);
    if (logged?.id) {
      await admin
        .from("webhook_events_log")
        .update({ status: "processed", processed_at: new Date().toISOString() })
        .eq("id", logged.id);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error("[evolution.webhook] handler failed", { requestId, message });
    if (logged?.id) {
      await admin
        .from("webhook_events_log")
        .update({ status: "error", error_message: message })
        .eq("id", logged.id);
    }
    return fail("internal_error", "evolution_ingest_failed", 500, { requestId });
  }

  return ok({ accepted: true }, { requestId });
}
