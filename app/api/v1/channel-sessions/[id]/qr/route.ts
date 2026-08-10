/**
 * GET /api/v1/channel-sessions/[id]/qr — proxy do QR de UM canal específico.
 *
 * Faz proxy da Evolution para o browser poder exibir o QR sem expor a API key.
 * sem expor a API key — mas resolve a sessão por `id` (multi-número), não pelo
 * nome derivado do org. organization_id vem da sessão autenticada.
 */
import { NextResponse } from "next/server";
import QRCode from "qrcode";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getEvolutionClient } from "@/lib/evolution/client";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const user = await loadAuthUser();
  if (!user) return new NextResponse(null, { status: 401 });
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return new NextResponse(null, { status: 403 });

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("channel_sessions")
    .select("provider,external_session_name")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!session) return new NextResponse(null, { status: 404 });

  if (session.provider !== "evolution" || !session.external_session_name) {
    return new NextResponse(null, { status: 409 });
  }
  const evolution = getEvolutionClient();
  if (!evolution) return new NextResponse(null, { status: 503 });
  try {
      const remote = await evolution.connect(session.external_session_name);
      const qr = remote.qrcode;
      if (!qr) return new NextResponse(null, { status: 202 });
      const isImageData = /^data:image\/\w+;base64,/.test(qr);
      const image = isImageData
        ? Buffer.from(qr.replace(/^data:image\/\w+;base64,/, ""), "base64")
        : await QRCode.toBuffer(qr, { width: 768, margin: 2 });
      return new NextResponse(new Uint8Array(image), {
        status: 200,
        headers: { "content-type": "image/png", "cache-control": "no-store, max-age=0" },
      });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
