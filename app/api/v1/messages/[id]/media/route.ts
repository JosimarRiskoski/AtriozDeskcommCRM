import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { fetchEvolutionMessageMedia } from "@/lib/messaging/media/evolution-api-source";
import { resolveByteRange } from "@/lib/http/byte-range";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const SIGNED_URL_TTL_S = 3600;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mediaResponse(
  buffer: Buffer,
  mime: string,
  requestId: string,
  rangeHeader: string | null,
): Response {
  const headers = new Headers({
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=60",
    "X-Request-Id": requestId,
  });
  const range = resolveByteRange(rangeHeader, buffer.byteLength);
  if (!range) {
    headers.set("Content-Length", String(buffer.byteLength));
    return new Response(new Uint8Array(buffer), { status: 200, headers });
  }
  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${buffer.byteLength}`);
    return new Response(null, { status: 416, headers });
  }
  const { start, end } = range;
  const chunk = buffer.subarray(start, end + 1);
  headers.set("Content-Length", String(chunk.byteLength));
  headers.set("Content-Range", `bytes ${start}-${end}/${buffer.byteLength}`);
  return new Response(new Uint8Array(chunk), { status: 206, headers });
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: messageId } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) return fail("unauthenticated", "Autenticação necessária.", 401, { requestId });

  const authUser = await loadAuthUser();
  const activeOrg = authUser ? await resolveActiveOrg(authUser) : null;
  if (!activeOrg) return fail("no_active_org", "Organização ativa não encontrada.", 403, { requestId });

  const { data: msg, error } = await supabase
    .from("messages")
    .select("id, channel_session_id, media_url, media_mime, media_storage_path, metadata")
    .eq("id", messageId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (error) return fail("internal_error", "Erro ao buscar mensagem.", 500, { requestId });
  const evolutionMessage = record(record(msg?.metadata).evolution_message);
  if (!msg || (!msg.media_storage_path && !msg.media_url && !Object.keys(evolutionMessage).length)) {
    return fail("not_found", "Mensagem sem mídia.", 404, { requestId });
  }

  const admin = createAdminClient();
  if (msg.media_storage_path) {
    const { data: signed, error: signErr } = await admin.storage
      .from("whatsapp-media")
      .createSignedUrl(msg.media_storage_path, SIGNED_URL_TTL_S);
    if (!signErr && signed?.signedUrl) {
      const response = NextResponse.redirect(signed.signedUrl, 302);
      response.headers.set("X-Request-Id", requestId);
      return response;
    }
    if (signErr) console.error("[messages.media] createSignedUrl failed", signErr.message);
  }

  try {
    const { data: session } = await admin
      .from("channel_sessions")
      .select("provider, external_session_name")
      .eq("id", msg.channel_session_id)
      .eq("organization_id", activeOrg.orgId)
      .maybeSingle();
    if (!session || session.provider !== "evolution") {
      return fail("unsupported_provider", "Mídia não pertence à Evolution API.", 409, { requestId });
    }
    const media = await fetchEvolutionMessageMedia({
      mediaUrl: msg.media_url,
      hintMime: msg.media_mime,
      instanceName: session.external_session_name,
      message: evolutionMessage,
    });
    return mediaResponse(media.buffer, media.mime, requestId, req.headers.get("range"));
  } catch (downloadError) {
    console.error("[messages.media] Evolution download failed", {
      request_id: requestId,
      message_id: messageId,
      error: downloadError instanceof Error ? downloadError.message : String(downloadError),
    });
    return fail("bad_gateway", "Mídia indisponível. Tente novamente.", 502, { requestId });
  }
}
