import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getEvolutionClient } from "@/lib/evolution/client";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  contact_id: z.string().uuid(),
  channel_session_id: z.string().uuid(),
  body: z.string().trim().min(1).max(4096),
});

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const parsed = inputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return fail("invalid_request", "Informe contato, conexão e a primeira mensagem.", 422, {
      requestId,
    });

  const supabase = await createClient();
  const { data: contact } = await supabase
    .from("contacts")
    .select("id,phone_number,is_blocked,is_anonymized")
    .eq("id", parsed.data.contact_id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (!contact) return fail("not_found", "Contato não encontrado.", 404, { requestId });
  if (contact.is_blocked || contact.is_anonymized)
    return fail("forbidden", "Este contato não está elegível para receber mensagens.", 403, {
      requestId,
    });
  if (!contact.phone_number)
    return fail("invalid_request", "O contato não possui telefone válido.", 422, { requestId });

  const { data: channel } = await supabase
    .from("channel_sessions")
    .select("id,provider,external_session_name,status,archived_at")
    .eq("id", parsed.data.channel_session_id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (
    !channel ||
    channel.archived_at ||
    channel.status !== "WORKING" ||
    channel.provider !== "evolution" ||
    !channel.external_session_name
  )
    return fail("channel_unavailable", "Escolha uma conexão WhatsApp ativa.", 409, { requestId });

  const evolution = getEvolutionClient();
  if (!evolution)
    return fail(
      "channel_unavailable",
      "Não foi possível verificar o WhatsApp neste momento.",
      503,
      { requestId },
    );
  let verifiedChatId: string | null = null;
  try {
    const result = await evolution.checkNumbers(channel.external_session_name, [
      contact.phone_number,
    ]);
    const row = (Array.isArray(result) ? result[0] : (result as { data?: unknown[] }).data?.[0]) as
      { exists?: boolean; numberExists?: boolean; jid?: string; number?: string } | undefined;
    if (!row || !(row.exists ?? row.numberExists))
      return fail("not_found", "Número não encontrado no WhatsApp.", 422, { requestId });
    verifiedChatId = row.jid ?? row.number ?? contact.phone_number;
  } catch {
    return fail(
      "channel_unavailable",
      "Não foi possível verificar o WhatsApp. Tente novamente antes de enviar.",
      503,
      { requestId },
    );
  }

  if (verifiedChatId) {
    await supabase
      .from("contacts")
      .update({
        wa_identity: verifiedChatId,
      })
      .eq("id", contact.id)
      .eq("organization_id", authz.org.orgId);
  }

  const admin = createAdminClient();
  const { data: conversationId, error: conversationError } = await admin.rpc(
    "fn_upsert_wa_conversation",
    {
      p_org: authz.org.orgId,
      p_contact: contact.id,
      p_session: channel.id,
    },
  );
  if (conversationError || typeof conversationId !== "string")
    return fail("internal_error", "Não foi possível preparar a conversa.", 500, { requestId });

  try {
    const message = await sendMessageHandler(
      supabase,
      {
        organization_id: authz.org.orgId,
        actor: { type: "user", id: authz.user.id },
        requestId,
      },
      { conversation_id: conversationId, type: "text", body: parsed.data.body },
    );
    return ok({ conversation_id: conversationId, message }, { status: 201, requestId });
  } catch (error) {
    if (error instanceof ApiError)
      return fail(error.code, error.message, error.status, { requestId });
    throw error;
  }
}
