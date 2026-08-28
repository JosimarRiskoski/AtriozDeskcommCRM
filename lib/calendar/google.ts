import type { GoogleCalendarConfig } from "./config";
import { GOOGLE_CALENDAR_SCOPES } from "./config";

export function buildGoogleAuthorizeUrl(config: GoogleCalendarConfig, state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

export interface GoogleTokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type: string;
}

export async function exchangeGoogleCode(
  config: GoogleCalendarConfig,
  code: string,
): Promise<GoogleTokenSet> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    }),
    cache: "no-store",
  });
  const json = (await response.json()) as GoogleTokenSet & { error?: string; error_description?: string };
  if (!response.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || `google_token_${response.status}`);
  }
  return json;
}

export async function refreshGoogleAccessToken(
  config: GoogleCalendarConfig,
  refreshToken: string,
): Promise<GoogleTokenSet> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const json = (await response.json()) as GoogleTokenSet & { error?: string; error_description?: string };
  if (!response.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || `google_refresh_${response.status}`);
  }
  return json;
}

async function googleJson<T>(accessToken: string, url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const json = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(json.error?.message || `google_calendar_${response.status}`);
  return json;
}

export async function getGoogleAccount(accessToken: string): Promise<{ email?: string }> {
  return googleJson(accessToken, "https://www.googleapis.com/oauth2/v2/userinfo");
}

export interface GoogleEventInput {
  calendarId: string;
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  location?: string | null;
  attendeeEmail?: string | null;
  createMeet?: boolean;
}

export async function createGoogleEvent(accessToken: string, input: GoogleEventInput) {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`,
  );
  if (input.createMeet) url.searchParams.set("conferenceDataVersion", "1");
  const body: Record<string, unknown> = {
    summary: input.title,
    description: input.description || undefined,
    location: input.location || undefined,
    start: { dateTime: input.startsAt, timeZone: input.timezone },
    end: { dateTime: input.endsAt, timeZone: input.timezone },
    attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : undefined,
  };
  if (input.createMeet) {
    body.conferenceData = {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }
  return googleJson<{
    id: string;
    htmlLink?: string;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
  }>(accessToken, url.toString(), { method: "POST", body: JSON.stringify(body) });
}

export async function updateGoogleEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  patch: Record<string, unknown>,
) {
  return googleJson(
    accessToken,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
}

export async function deleteGoogleEvent(accessToken: string, calendarId: string, eventId: string) {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" },
  );
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(`google_calendar_delete_${response.status}`);
  }
}

export interface GoogleCalendarEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email?: string; responseStatus?: string }>;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
}

export class GoogleSyncTokenExpiredError extends Error {}

export async function listGoogleEvents(
  accessToken: string,
  calendarId: string,
  options: { syncToken?: string | null; timeMin?: string },
): Promise<{ events: GoogleCalendarEvent[]; nextSyncToken: string }> {
  const events: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken = "";
  do {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    );
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "true");
    url.searchParams.set("maxResults", "2500");
    if (options.syncToken) url.searchParams.set("syncToken", options.syncToken);
    else if (options.timeMin) url.searchParams.set("timeMin", options.timeMin);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (response.status === 410) throw new GoogleSyncTokenExpiredError("google_sync_token_expired");
    const json = (await response.json()) as {
      items?: GoogleCalendarEvent[];
      nextPageToken?: string;
      nextSyncToken?: string;
      error?: { message?: string };
    };
    if (!response.ok) throw new Error(json.error?.message || `google_calendar_${response.status}`);
    events.push(...(json.items ?? []));
    pageToken = json.nextPageToken;
    nextSyncToken = json.nextSyncToken || nextSyncToken;
  } while (pageToken);
  if (!nextSyncToken) throw new Error("google_calendar_missing_sync_token");
  return { events, nextSyncToken };
}

export async function queryGoogleFreeBusy(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
  timezone: string,
): Promise<Array<{ start: string; end: string }>> {
  const result = await googleJson<{
    calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
  }>(accessToken, "https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin, timeMax, timeZone: timezone, items: [{ id: calendarId }] }),
  });
  return result.calendars?.[calendarId]?.busy ?? [];
}
