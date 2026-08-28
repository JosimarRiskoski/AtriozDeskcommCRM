import type { SupabaseClient } from "@supabase/supabase-js";

import { getCalendarAccess } from "./access";
import {
  GoogleSyncTokenExpiredError,
  listGoogleEvents,
  type GoogleCalendarEvent,
} from "./google";

function eventTimes(event: GoogleCalendarEvent): { startsAt: string; endsAt: string; allDay: boolean } | null {
  const start = event.start?.dateTime || event.start?.date;
  const end = event.end?.dateTime || event.end?.date;
  if (!start || !end) return null;
  const startsAt = new Date(start).toISOString();
  const endsAt = new Date(end).toISOString();
  if (endsAt <= startsAt) return null;
  return { startsAt, endsAt, allDay: !event.start?.dateTime };
}

export function googleEventToAppointment(
  event: GoogleCalendarEvent,
  input: { organizationId: string; integrationId: string; calendarId: string; timezone: string },
) {
  const times = eventTimes(event);
  if (!event.id || !times) return null;
  const meetUrl =
    event.hangoutLink ||
    event.conferenceData?.entryPoints?.find((point) => point.entryPointType === "video")?.uri ||
    null;
  return {
    organization_id: input.organizationId,
    integration_id: input.integrationId,
    external_event_id: event.id,
    external_calendar_id: input.calendarId,
    appointment_type: meetUrl ? "online" : "other",
    title: event.summary?.trim() || "Evento do Google Agenda",
    description: event.description ?? null,
    status: event.status === "cancelled" ? "cancelled" : "scheduled",
    starts_at: times.startsAt,
    ends_at: times.endsAt,
    timezone: event.start?.timeZone || input.timezone,
    location: event.location ?? null,
    meet_url: meetUrl,
    attendee_email: event.attendees?.find((attendee) => attendee.email)?.email ?? null,
    cancelled_at: event.status === "cancelled" ? new Date().toISOString() : null,
    cancellation_reason: event.status === "cancelled" ? "Cancelado no Google Agenda" : null,
    metadata: {
      google_html_link: event.htmlLink ?? null,
      google_updated_at: event.updated ?? null,
      google_all_day: times.allDay,
      imported_from_google: true,
    },
  };
}

export async function syncGoogleCalendar(admin: SupabaseClient, organizationId: string) {
  const { accessToken, integration } = await getCalendarAccess(admin, organizationId);
  const run = async (syncToken: string | null) =>
    listGoogleEvents(accessToken, integration.calendar_id, {
      syncToken,
      timeMin: syncToken ? undefined : new Date(Date.now() - 90 * 86400000).toISOString(),
    });
  let result;
  try {
    result = await run(integration.events_sync_token);
  } catch (error) {
    if (!(error instanceof GoogleSyncTokenExpiredError)) throw error;
    result = await run(null);
  }

  const cancelledIds = result.events
    .filter((event) => event.status === "cancelled" && event.id)
    .map((event) => event.id);
  const rows = result.events
    .filter((event) => event.status !== "cancelled")
    .map((event) =>
      googleEventToAppointment(event, {
        organizationId,
        integrationId: integration.id,
        calendarId: integration.calendar_id,
        timezone: integration.timezone,
      }),
    )
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (rows.length) {
    const { error } = await admin.from("calendar_appointments").upsert(rows, {
      onConflict: "organization_id,external_calendar_id,external_event_id",
    });
    if (error) throw error;
  }
  if (cancelledIds.length) {
    const { data: cancelledAppointments, error } = await admin
      .from("calendar_appointments")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancellation_reason: "Cancelado no Google Agenda",
      })
      .eq("organization_id", organizationId)
      .eq("external_calendar_id", integration.calendar_id)
      .in("external_event_id", cancelledIds)
      .select("id");
    if (error) throw error;
    const appointmentIds = (cancelledAppointments ?? []).map((item) => item.id);
    if (appointmentIds.length) {
      const { error: reminderError } = await admin
        .from("calendar_reminders")
        .update({ status: "cancelled", claimed_until: null })
        .in("appointment_id", appointmentIds)
        .in("status", ["pending", "processing", "failed"]);
      if (reminderError) throw reminderError;
    }
  }
  const completedAt = new Date().toISOString();
  const { error: integrationError } = await admin
    .from("calendar_integrations")
    .update({ events_sync_token: result.nextSyncToken, last_sync_at: completedAt, last_error: null })
    .eq("id", integration.id);
  if (integrationError) throw integrationError;
  return {
    imported_or_updated: rows.length,
    cancelled: cancelledIds.length,
    completed_at: completedAt,
  };
}
