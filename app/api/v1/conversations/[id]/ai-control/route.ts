import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  mode: z.enum(["inherit", "force_active", "force_paused"]),
});

interface RouteCtx {
  params: Promise<{ id: string }>;
}

interface AiControlRow {
  id: string;
  contact_id: string;
  ai_control_mode: "inherit" | "force_active" | "force_paused";
  bot_silenced_until: string | null;
  handoff_cleared: boolean;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Modo de IA inválido.", 422, { requestId });
  }

  const { user, org } = authz;
  const supabase = await createClient();

  // A troca para force_active precisa ser atômica: o handoff grava duas travas
  // (silêncio da conversa e force_human do contato). Atualizar apenas o modo
  // fazia o botão "Devolver para IA" parecer concluído, mas o worker continuava
  // recusando o turno. Opt-out/LGPD nunca é removido por este caminho.
  const { data: rpcData, error } = await supabase.rpc(
    "fn_set_conversation_ai_control" as never,
    {
      p_organization_id: org.orgId,
      p_conversation_id: id,
      p_mode: parsed.data.mode,
    } as never,
  );
  if (error) {
    if (error.message.includes("contact_communication_blocked")) {
      return fail(
        "invalid_state",
        "Este contato está bloqueado para comunicação e não pode ser devolvido à IA.",
        409,
        { requestId },
      );
    }
    return fail("internal_error", error.message, 500, { requestId });
  }
  const data = (rpcData as unknown as AiControlRow[] | null)?.[0] ?? null;
  if (!data) return fail("not_found", "Conversa não encontrada.", 404, { requestId });

  await audit({
    action: "ai.contact_control_changed",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "conversation",
    resourceId: id,
    requestId,
    metadata: { mode: parsed.data.mode, cleared_handoff_silence: data.handoff_cleared },
  });

  // Mantém o mesmo sinal de retomada usado pelo handoff para que um follow-up
  // pausado não fique órfão depois de devolver a conversa à IA.
  if (data.handoff_cleared) {
    const { error: emitErr } = await supabase.rpc("emit_event", {
      p_event_type: "ai.handoff_resolved",
      p_entity_kind: "conversation",
      p_entity_id: id,
      p_payload: { conversation_id: id, contact_id: data.contact_id, organization_id: org.orgId },
      p_metadata: { source: "conversation_ai_control", request_id: requestId },
      p_organization_id: org.orgId,
    });
    if (emitErr) {
      // A mudanca principal ja foi confirmada atomicamente pela RPC acima.
      // Nao devolvemos 500 depois do commit: isso faria a interface dizer que
      // a IA continuou pausada quando o banco ja esta em `force_active`.
      // Follow-up e independente da IA; uma falha no sinal de retomada fica
      // registrada para diagnostico, sem mentir sobre o estado da conversa.
      console.error("[conversation.ai-control] handoff resume event failed", {
        requestId,
        conversationId: id,
        error: emitErr.message,
      });
    }
  }

  return ok(
    { mode: data.ai_control_mode, bot_silenced_until: data.bot_silenced_until },
    { requestId },
  );
}
