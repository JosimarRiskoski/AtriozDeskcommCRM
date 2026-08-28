import type { SupabaseClient } from "@supabase/supabase-js";

import { getGoogleCalendarConfig } from "./config";
import { refreshGoogleAccessToken } from "./google";
import { decryptWebhookSecret, encryptWebhookSecret } from "@/lib/webhooks/secrets";

export interface CalendarIntegrationRow {
  id: string;
  organization_id: string;
  oauth_access_token_encrypted: string;
  oauth_refresh_token_encrypted: string | null;
  token_expires_at: string | null;
  calendar_id: string;
  events_sync_token: string | null;
  timezone: string;
  reminder_24h_enabled: boolean;
  reminder_1h_enabled: boolean;
  reminder_24h_template: string;
  reminder_1h_template: string;
}

export async function getCalendarAccess(
  admin: SupabaseClient,
  organizationId: string,
): Promise<{ accessToken: string; integration: CalendarIntegrationRow }> {
  const { data, error } = await admin
    .from("calendar_integrations")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("status", "connected")
    .maybeSingle();
  if (error || !data) throw new Error("google_calendar_not_connected");
  const integration = data as CalendarIntegrationRow;
  const expiresAt = integration.token_expires_at
    ? new Date(integration.token_expires_at).getTime()
    : 0;
  let accessToken = await decryptWebhookSecret(admin, integration.oauth_access_token_encrypted);
  if (!accessToken) throw new Error("google_calendar_access_token_unreadable");
  if (expiresAt > Date.now() + 60_000) return { accessToken, integration };

  if (!integration.oauth_refresh_token_encrypted) throw new Error("google_calendar_refresh_missing");
  const refreshToken = await decryptWebhookSecret(
    admin,
    integration.oauth_refresh_token_encrypted,
  );
  const config = getGoogleCalendarConfig();
  if (!refreshToken || !config) throw new Error("google_calendar_refresh_unavailable");
  const refreshed = await refreshGoogleAccessToken(config, refreshToken);
  const encrypted = await encryptWebhookSecret(admin, refreshed.access_token);
  if (!encrypted) throw new Error("google_calendar_refresh_encrypt_failed");
  await admin
    .from("calendar_integrations")
    .update({
      oauth_access_token_encrypted: encrypted,
      token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      status: "connected",
      last_error: null,
    })
    .eq("id", integration.id);
  accessToken = refreshed.access_token;
  return { accessToken, integration };
}
