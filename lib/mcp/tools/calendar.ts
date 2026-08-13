import { z } from "zod";

import { getCalendarAccess } from "@/lib/calendar/access";
import {
  createGoogleEvent,
  deleteGoogleEvent,
  queryGoogleFreeBusy,
  updateGoogleEvent,
} from "@/lib/calendar/google";
import { renderReminderTemplate } from "@/lib/calendar/templates";
import type { McpToolDefinition } from "../types";

const listShape = {
  contact_id: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(50).default(20),
};

export const crmCalendarListAppointments: McpToolDefinition<typeof listShape> = {
  name: "crm_calendar_list_appointments",
  description: "Consulta compromissos futuros do contato ou da organização. Use antes de remarcar ou cancelar.",
  inputSchema: listShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    let query = ctx.supabase
      .from("calendar_appointments")
      .select("id,contact_id,title,status,starts_at,ends_at,timezone,location,meet_url,appointment_type")
      .eq("organization_id", ctx.organizationId)
      .gte("starts_at", input.from ?? new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(input.limit);
    if (input.contact_id) query = query.eq("contact_id", input.contact_id);
    if (input.until) query = query.lte("starts_at", input.until);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return { appointments: data ?? [] };
  },
};

const availabilityShape = {
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  timezone: z.string().default("America/Sao_Paulo"),
};

export const crmCalendarCheckAvailability: McpToolDefinition<typeof availabilityShape> = {
  name: "crm_calendar_check_availability",
  description: "Confere no Google Agenda se um intervalo está livre. Não cria nem altera compromisso.",
  inputSchema: availabilityShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const { accessToken, integration } = await getCalendarAccess(ctx.supabase, ctx.organizationId);
    const busy = await queryGoogleFreeBusy(
      accessToken,
      integration.calendar_id,
      input.starts_at,
      input.ends_at,
      input.timezone,
    );
    return { available: busy.length === 0, busy };
  },
};

const createShape = {
  explicit_confirmation: z.literal(true).describe("Somente true após o cliente confirmar claramente data e horário."),
  contact_id: z.string().uuid(),
  conversation_id: z.string().uuid().optional(),
  title: z.string().min(2).max(180),
  appointment_type: z.enum(["visit", "consultation", "online", "other"]),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  timezone: z.string().default("America/Sao_Paulo"),
  location: z.string().max(500).optional(),
  attendee_email: z.string().email().optional(),
  create_meet: z.boolean().default(false),
};

export const crmCalendarCreateAppointment: McpToolDefinition<typeof createShape> = {
  name: "crm_calendar_create_appointment",
  description:
    "Cria compromisso no Google Agenda somente depois de confirmação explícita do cliente. " +
    "Nunca presuma horário. Antes, use crm_calendar_check_availability. Os lembretes usam textos fixos configurados pelo administrador.",
  inputSchema: createShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data: contact } = await ctx.supabase
      .from("contacts")
      .select("id,name,display_name,email,is_blocked")
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.contact_id)
      .maybeSingle();
    if (!contact) throw new Error("contact_not_found");
    if (contact.is_blocked) throw new Error("contact_blocked");
    let conversationId = input.conversation_id ?? null;
    if (!conversationId) {
      const { data: conversation } = await ctx.supabase
        .from("conversations")
        .select("id")
        .eq("organization_id", ctx.organizationId)
        .eq("contact_id", input.contact_id)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      conversationId = conversation?.id ?? null;
    }
    const { accessToken, integration } = await getCalendarAccess(ctx.supabase, ctx.organizationId);
    const busy = await queryGoogleFreeBusy(
      accessToken,
      integration.calendar_id,
      input.starts_at,
      input.ends_at,
      input.timezone,
    );
    if (busy.length) return { created: false, reason: "time_not_available", busy };
    const event = await createGoogleEvent(accessToken, {
      calendarId: integration.calendar_id,
      title: input.title,
      startsAt: input.starts_at,
      endsAt: input.ends_at,
      timezone: input.timezone,
      location: input.location,
      attendeeEmail: input.attendee_email || contact.email,
      createMeet: input.create_meet,
    });
    const meetUrl = event.hangoutLink ?? null;
    const { data: appointment, error } = await ctx.supabase
      .from("calendar_appointments")
      .insert({
        organization_id: ctx.organizationId,
        integration_id: integration.id,
        contact_id: input.contact_id,
        conversation_id: conversationId,
        external_event_id: event.id,
        external_calendar_id: integration.calendar_id,
        appointment_type: input.appointment_type,
        title: input.title,
        starts_at: input.starts_at,
        ends_at: input.ends_at,
        timezone: input.timezone,
        location: input.location ?? null,
        meet_url: meetUrl,
        attendee_email: input.attendee_email || contact.email || null,
        reminder_24h_enabled: integration.reminder_24h_enabled,
        reminder_1h_enabled: integration.reminder_1h_enabled,
      })
      .select("*")
      .single();
    if (error || !appointment) throw new Error(error?.message || "appointment_insert_failed");
    const startsAtMs = new Date(input.starts_at).getTime();
    const templateContext = {
      contactName: contact.name || contact.display_name,
      startsAt: input.starts_at,
      timezone: input.timezone,
      location: input.location,
      meetUrl,
    };
    const reminders = [
      { kind: "24h", enabled: integration.reminder_24h_enabled, at: startsAtMs - 86400000, template: integration.reminder_24h_template },
      { kind: "1h", enabled: integration.reminder_1h_enabled, at: startsAtMs - 3600000, template: integration.reminder_1h_template },
    ].filter((item) => item.enabled && item.at > Date.now());
    if (reminders.length) {
      await ctx.supabase.from("calendar_reminders").insert(reminders.map((item) => ({
        organization_id: ctx.organizationId,
        appointment_id: appointment.id,
        conversation_id: conversationId,
        reminder_kind: item.kind,
        scheduled_for: new Date(item.at).toISOString(),
        message_body: renderReminderTemplate(item.template, templateContext),
      })));
    }
    return { created: true, appointment_id: appointment.id, starts_at: input.starts_at, meet_url: meetUrl };
  },
};

const rescheduleShape = {
  appointment_id: z.string().uuid(),
  explicit_confirmation: z.literal(true),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  timezone: z.string().default("America/Sao_Paulo"),
};

export const crmCalendarRescheduleAppointment: McpToolDefinition<typeof rescheduleShape> = {
  name: "crm_calendar_reschedule_appointment",
  description: "Remarca um compromisso somente após o cliente confirmar explicitamente o novo horário.",
  inputSchema: rescheduleShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data: appointment } = await ctx.supabase.from("calendar_appointments").select("*, contacts:contact_id(name,display_name)").eq("id", input.appointment_id).eq("organization_id", ctx.organizationId).maybeSingle();
    if (!appointment) throw new Error("appointment_not_found");
    const { accessToken, integration } = await getCalendarAccess(ctx.supabase, ctx.organizationId);
    const busy = await queryGoogleFreeBusy(accessToken, integration.calendar_id, input.starts_at, input.ends_at, input.timezone);
    if (busy.length) return { rescheduled: false, reason: "time_not_available", busy };
    await updateGoogleEvent(accessToken, appointment.external_calendar_id, appointment.external_event_id, {
      start: { dateTime: input.starts_at, timeZone: input.timezone },
      end: { dateTime: input.ends_at, timeZone: input.timezone },
    });
    await ctx.supabase.from("calendar_appointments").update({ status: "rescheduled", starts_at: input.starts_at, ends_at: input.ends_at, timezone: input.timezone }).eq("id", appointment.id);
    const startsAtMs = new Date(input.starts_at).getTime();
    const contact = Array.isArray(appointment.contacts) ? appointment.contacts[0] : appointment.contacts;
    const templateContext = {
      contactName: contact?.name || contact?.display_name,
      startsAt: input.starts_at,
      timezone: input.timezone,
      location: appointment.location,
      meetUrl: appointment.meet_url,
    };
    const reminders = [
      { kind: "24h", enabled: appointment.reminder_24h_enabled, at: startsAtMs - 86400000, template: integration.reminder_24h_template },
      { kind: "1h", enabled: appointment.reminder_1h_enabled, at: startsAtMs - 3600000, template: integration.reminder_1h_template },
    ];
    for (const reminder of reminders) {
      if (!reminder.enabled || reminder.at <= Date.now()) {
        await ctx.supabase.from("calendar_reminders").update({ status: "cancelled" }).eq("appointment_id", appointment.id).eq("reminder_kind", reminder.kind);
        continue;
      }
      await ctx.supabase.from("calendar_reminders").upsert({
        organization_id: ctx.organizationId,
        appointment_id: appointment.id,
        conversation_id: appointment.conversation_id,
        reminder_kind: reminder.kind,
        scheduled_for: new Date(reminder.at).toISOString(),
        message_body: renderReminderTemplate(reminder.template, templateContext),
        status: "pending",
        claimed_at: null,
        claimed_until: null,
        sent_message_id: null,
        sent_at: null,
        last_error: null,
      }, { onConflict: "appointment_id,reminder_kind" });
    }
    return { rescheduled: true, appointment_id: appointment.id, starts_at: input.starts_at };
  },
};

const cancelShape = {
  appointment_id: z.string().uuid(),
  explicit_confirmation: z.literal(true),
  reason: z.string().max(500).optional(),
};

export const crmCalendarCancelAppointment: McpToolDefinition<typeof cancelShape> = {
  name: "crm_calendar_cancel_appointment",
  description: "Cancela um compromisso somente depois de o cliente confirmar claramente o cancelamento.",
  inputSchema: cancelShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data: appointment } = await ctx.supabase.from("calendar_appointments").select("*").eq("id", input.appointment_id).eq("organization_id", ctx.organizationId).maybeSingle();
    if (!appointment) throw new Error("appointment_not_found");
    const { accessToken } = await getCalendarAccess(ctx.supabase, ctx.organizationId);
    await deleteGoogleEvent(accessToken, appointment.external_calendar_id, appointment.external_event_id);
    await ctx.supabase.from("calendar_appointments").update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancellation_reason: input.reason ?? null }).eq("id", appointment.id);
    await ctx.supabase.from("calendar_reminders").update({ status: "cancelled" }).eq("appointment_id", appointment.id).in("status", ["pending", "processing", "failed"]);
    return { cancelled: true, appointment_id: appointment.id };
  },
};
