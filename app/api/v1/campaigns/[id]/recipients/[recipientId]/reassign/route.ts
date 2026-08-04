import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  channel_session_id: z.string().uuid(),
  confirmed: z.literal(true),
  reason: z.string().trim().min(3).max(240),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; recipientId: string }> },
) {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "outreach_campaigns" });
  if (!authz.ok) return authz.response;
  const { id, recipientId } = await context.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return fail("validation_failed", "Confirme a troca e informe o motivo.", 422, { requestId });

  const admin = createAdminClient() as unknown as SupabaseClient;
  const orgId = authz.org.orgId;
  const [{ data: recipient }, { data: target }] = await Promise.all([
    admin
      .from("outreach_campaign_recipients")
      .select(
        "id,status,contact_id,channel_session_id,contacts:contact_id(is_blocked,is_anonymized)",
      )
      .eq("id", recipientId)
      .eq("campaign_id", id)
      .eq("organization_id", orgId)
      .maybeSingle(),
    admin
      .from("channel_sessions")
      .select("id,status")
      .eq("id", parsed.data.channel_session_id)
      .eq("organization_id", orgId)
      .maybeSingle(),
  ]);
  if (!recipient) return fail("not_found", "Destinatário não encontrado.", 404, { requestId });
  if (recipient.status !== "pending")
    return fail(
      "conflict",
      "Somente destinatários ainda não enviados podem trocar de conexão.",
      409,
      { requestId },
    );
  const contact = recipient.contacts as unknown as {
    is_blocked: boolean;
    is_anonymized: boolean;
  } | null;
  if (contact?.is_blocked || contact?.is_anonymized)
    return fail("forbidden", "O contato está bloqueado para comunicação.", 403, { requestId });
  if (!target || target.status !== "WORKING")
    return fail("validation_failed", "A nova conexão precisa estar ativa.", 422, { requestId });
  if (recipient.channel_session_id === target.id)
    return fail("conflict", "O destinatário já está nessa conexão.", 409, { requestId });

  const { data: conversationId, error: conversationError } = await admin.rpc(
    "fn_upsert_wa_conversation",
    {
      p_org: orgId,
      p_contact: recipient.contact_id,
      p_session: target.id,
    },
  );
  if (conversationError || typeof conversationId !== "string")
    return fail("internal_error", "Não foi possível preparar a conversa na nova conexão.", 500, {
      requestId,
    });
  const changedAt = new Date().toISOString();
  const { error } = await admin
    .from("outreach_campaign_recipients")
    .update({
      channel_session_id: target.id,
      conversation_id: conversationId,
      reassigned_at: changedAt,
      reassigned_by_user_id: authz.user.id,
      assignment_reason: parsed.data.reason,
      updated_at: changedAt,
    })
    .eq("id", recipient.id)
    .eq("status", "pending");
  if (error)
    return fail("internal_error", "Não foi possível trocar a conexão.", 500, { requestId });
  await admin.from("outreach_campaign_connection_events").insert({
    organization_id: orgId,
    campaign_id: id,
    recipient_id: recipient.id,
    from_channel_session_id: recipient.channel_session_id,
    to_channel_session_id: target.id,
    kind: "reassigned",
    reason: parsed.data.reason,
    actor_user_id: authz.user.id,
  });
  await audit({
    action: "campaign.recipient_connection_reassigned",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "outreach_campaign_recipient",
    resourceId: recipient.id,
    requestId,
    metadata: {
      campaign_id: id,
      from: recipient.channel_session_id,
      to: target.id,
      reason: parsed.data.reason,
    },
  });
  return ok(
    { recipient_id: recipient.id, channel_session_id: target.id, conversation_id: conversationId },
    { requestId },
  );
}
