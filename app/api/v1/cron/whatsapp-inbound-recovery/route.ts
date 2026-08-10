/**
 * GET/POST /api/v1/cron/whatsapp-inbound-recovery
 *
 * Reprocessa mensagens recebidas pelo WhatsApp que ficaram aguardando a
 * resolução @lid -> telefone. Deve ser agendado a cada minuto no scheduler da
 * VPS. Não envia mensagens: apenas conclui a gravação de entradas já recebidas.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcilePendingEvolutionInbound } from "@/lib/evolution/commercial-ingest";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authorization = req.headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const provided = bearer || (req.headers.get("x-cron-secret")?.trim() ?? "");
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  try {
    const summary = await reconcilePendingEvolutionInbound(createAdminClient());
    void audit({
      action: "whatsapp.inbound_recovery_run",
      organizationId: null,
      bypassedRls: true,
      requestId,
      metadata: summary,
    });
    return ok(summary, { requestId });
  } catch (error) {
    return fail(
      "internal_error",
      error instanceof Error ? error.message : "Falha ao recuperar mensagens do WhatsApp.",
      500,
      { requestId },
    );
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
