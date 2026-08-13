import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ok, fail } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(request: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authorization = request.headers.get("authorization") ?? "";
  const provided =
    (authorization.startsWith("Bearer ") ? authorization.slice(7) : "") ||
    request.headers.get("x-cron-secret") ||
    "";
  if (![env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean).includes(provided.trim())) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await admin.rpc("fn_claim_due_calendar_reminders", {
    p_limit: 25,
    p_lease_seconds: 180,
  });
  if (error) return fail("claim_failed", "Falha ao buscar lembretes pendentes.", 500, { requestId });

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const reminder of data ?? []) {
    let conversationId = reminder.conversation_id as string | null;
    if (!conversationId) {
      const { data: appointment } = await admin
        .from("calendar_appointments")
        .select("contact_id")
        .eq("id", reminder.appointment_id)
        .maybeSingle();
      if (appointment?.contact_id) {
        const { data: latestConversation } = await admin
          .from("conversations")
          .select("id")
          .eq("organization_id", reminder.organization_id)
          .eq("contact_id", appointment.contact_id)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();
        conversationId = latestConversation?.id ?? null;
        if (conversationId) {
          await admin.from("calendar_reminders").update({ conversation_id: conversationId }).eq("id", reminder.id);
        }
      }
    }
    if (!conversationId) {
      skipped += 1;
      await admin
        .from("calendar_reminders")
        .update({
          status: "skipped",
          claimed_until: null,
          last_error: "conversation_missing",
        })
        .eq("id", reminder.id);
      continue;
    }
    try {
      const message = await sendMessageHandler(
        admin,
        {
          organization_id: reminder.organization_id,
          actor: { type: "system", id: "calendar-reminder" },
          requestId: randomUUID(),
        },
        {
          conversation_id: conversationId,
          type: "text",
          body: reminder.message_body,
          metadata: {
            calendar_reminder_id: reminder.id,
            calendar_appointment_id: reminder.appointment_id,
            reminder_kind: reminder.reminder_kind,
          },
        },
      );
      sent += 1;
      await admin
        .from("calendar_reminders")
        .update({
          status: "sent",
          sent_message_id: message.id,
          sent_at: new Date().toISOString(),
          claimed_until: null,
          last_error: null,
        })
        .eq("id", reminder.id);
    } catch (error) {
      failed += 1;
      await admin
        .from("calendar_reminders")
        .update({
          status: "failed",
          claimed_until: null,
          last_error: error instanceof Error ? error.message.slice(0, 1000) : "unknown",
        })
        .eq("id", reminder.id);
    }
  }
  return ok({ claimed: data?.length ?? 0, sent, failed, skipped }, { requestId });
}

export const GET = handle;
export const POST = handle;
