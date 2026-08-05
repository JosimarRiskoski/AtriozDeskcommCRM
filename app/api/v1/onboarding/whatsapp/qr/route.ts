import { NextResponse } from "next/server";
import QRCode from "qrcode";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { getEvolutionClient } from "@/lib/evolution/client";

export async function GET() {
  const user = await loadAuthUser();
  if (!user) return new NextResponse(null, { status: 401 });
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return new NextResponse(null, { status: 404 });
  const evolution = getEvolutionClient();
  if (!evolution) return new NextResponse(null, { status: 503 });
  try {
    const remote = await evolution.connect(`org_${activeOrg.orgId.slice(0, 8)}`);
    if (!remote.qrcode) return new NextResponse(null, { status: 202 });
    const image = /^data:image\/\w+;base64,/.test(remote.qrcode)
      ? Buffer.from(remote.qrcode.replace(/^data:image\/\w+;base64,/, ""), "base64")
      : await QRCode.toBuffer(remote.qrcode, { width: 768, margin: 2 });
    return new NextResponse(new Uint8Array(image), {
      status: 200,
      headers: { "content-type": "image/png", "cache-control": "no-store" },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
