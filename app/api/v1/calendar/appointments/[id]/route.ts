import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { getCalendarAccess } from "@/lib/calendar/access";
import { deleteGoogleEvent, updateGoogleEvent } from "@/lib/calendar/google";
import { renderReminderTemplate } from "@/lib/calendar/templates";
import { createAdminClient } from "@/lib/supabase/admin";

const updateSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("cancel"),
    confirmed: z.literal(true),
    reason: z.string().trim().max(500).nullable().optional(),
  }),
  z
    .object({
      action: z.literal("reschedule"),
      confirmed: z.literal(true),
      starts_at: z.string().datetime(),
      ends_at: z.string().datetime(),
      timezone: z.string().trim().min(3).max(80),
      location: z.string().trim().max(500).nullable().optional(),
    })
    .refine((value) => new Date(value.ends_at) > new Date(value.starts_at), {
      path: ["ends_at"],
      message: "O término precisa ser posterior ao início.",
    }),
  z.object({ action: z.literal("complete"), confirmed: z.literal(true) }),
]);

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "calendar_appointments" });
  if (!authz.ok) return authz.response;
  const { id } = await context.params;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Dados inválidos.", 422, {
      requestId,
    });
  }
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: appointment } = await admin
    .from("calendar_appointments")
    .select("*, contacts:contact_id(name,display_name)")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (!appointment) return fail("not_found", "Compromisso não encontrado.", 404, { requestId });

  try {
    const { accessToken, integration } = await getCalendarAccess(admin, authz.org.orgId);
    if (parsed.data.action === "cancel") {
      if (appointment.external_event_id && appointment.external_calendar_id) {
        await deleteGoogleEvent(
          accessToken,
          appointment.external_calendar_id,
          appointment.external_event_id,
        );
      }
      await admin
        .from("calendar_appointments")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancellation_reason: parsed.data.reason ?? null,
        })
        .eq("id", id);
      await admin
        .from("calendar_reminders")
        .update({ status: "cancelled", claimed_until: null })
        .eq("appointment_id", id)
        .in("status", ["pending", "processing", "failed"]);
      return ok({ id, status: "cancelled" }, { requestId });
    }

    if (parsed.data.action === "complete") {
      await admin.from("calendar_appointments").update({ status: "completed" }).eq("id", id);
      await admin
        .from("calendar_reminders")
        .update({ status: "cancelled", claimed_until: null })
        .eq("appointment_id", id)
        .in("status", ["pending", "processing", "failed"]);
      return ok({ id, status: "completed" }, { requestId });
    }

    if (appointment.external_event_id && appointment.external_calendar_id) {
      await updateGoogleEvent(
        accessToken,
        appointment.external_calendar_id,
        appointment.external_event_id,
        {
          start: { dateTime: parsed.data.starts_at, timeZone: parsed.data.timezone },
          end: { dateTime: parsed.data.ends_at, timeZone: parsed.data.timezone },
          location: parsed.data.location || undefined,
        },
      );
    }
    const { error: updateError } = await admin
      .from("calendar_appointments")
      .update({
        status: "rescheduled",
        starts_at: parsed.data.starts_at,
        ends_at: parsed.data.ends_at,
        timezone: parsed.data.timezone,
        location: parsed.data.location ?? null,
        cancelled_at: null,
        cancellation_reason: null,
      })
      .eq("id", id);
    if (updateError) throw updateError;

    const startsAtMs = new Date(parsed.data.starts_at).getTime();
    const contact = Array.isArray(appointment.contacts)
      ? appointment.contacts[0]
      : appointment.contacts;
    const ctx = {
      contactName: contact?.name || contact?.display_name,
      startsAt: parsed.data.starts_at,
      timezone: parsed.data.timezone,
      location: parsed.data.location,
      meetUrl: appointment.meet_url,
    };
    const reminders = [
      {
        kind: "24h",
        enabled: appointment.reminder_24h_enabled,
        scheduled: startsAtMs - 86400000,
        template: integration.reminder_24h_template,
      },
      {
        kind: "1h",
        enabled: appointment.reminder_1h_enabled,
        scheduled: startsAtMs - 3600000,
        template: integration.reminder_1h_template,
      },
    ];
    for (const reminder of reminders) {
      if (!reminder.enabled || reminder.scheduled <= Date.now()) {
        await admin
          .from("calendar_reminders")
          .update({ status: "cancelled" })
          .eq("appointment_id", id)
          .eq("reminder_kind", reminder.kind);
        continue;
      }
      await admin.from("calendar_reminders").upsert(
        {
          organization_id: authz.org.orgId,
          appointment_id: id,
          conversation_id: appointment.conversation_id,
          reminder_kind: reminder.kind,
          scheduled_for: new Date(reminder.scheduled).toISOString(),
          message_body: renderReminderTemplate(reminder.template, ctx),
          status: "pending",
          claimed_at: null,
          claimed_until: null,
          sent_message_id: null,
          sent_at: null,
          last_error: null,
        },
        { onConflict: "appointment_id,reminder_kind" },
      );
    }
    return ok({ id, status: "rescheduled" }, { requestId });
  } catch (error) {
    return fail("calendar_update_failed", "Não foi possível atualizar o compromisso.", 502, {
      requestId,
      details: { reason: error instanceof Error ? error.message : "unknown" },
    });
  }
}
