import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { getGoogleCalendarConfig } from "@/lib/calendar/config";
import { exchangeGoogleCode, getGoogleAccount } from "@/lib/calendar/google";
import { verifyCalendarState } from "@/lib/calendar/state";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function back(path: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return NextResponse.redirect(new URL(path, base));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const state = verifyCalendarState(url.searchParams.get("state"));
  const code = url.searchParams.get("code");
  const config = getGoogleCalendarConfig();
  if (!config) return back("/app/settings/google-calendar?error=not_configured");
  if (!state) return back("/app/settings/google-calendar?error=invalid_state");
  if (!code) return back("/app/settings/google-calendar?error=missing_code");

  try {
    const tokens = await exchangeGoogleCode(config, code);
    const account: { email?: string } = await getGoogleAccount(tokens.access_token).catch(() => ({}));
    const admin = createAdminClient() as unknown as SupabaseClient;
    const accessEncrypted = await encryptWebhookSecret(admin, tokens.access_token);
    const refreshEncrypted = tokens.refresh_token
      ? await encryptWebhookSecret(admin, tokens.refresh_token)
      : null;
    if (!accessEncrypted) throw new Error("encrypt_access_failed");

    const { data: previous } = await admin
      .from("calendar_integrations")
      .select("oauth_refresh_token_encrypted")
      .eq("organization_id", state.organizationId)
      .maybeSingle();

    const { error } = await admin.from("calendar_integrations").upsert(
      {
        organization_id: state.organizationId,
        provider: "google_calendar",
        google_account_email: account.email ?? null,
        oauth_access_token_encrypted: accessEncrypted,
        oauth_refresh_token_encrypted:
          refreshEncrypted ?? previous?.oauth_refresh_token_encrypted ?? null,
        scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        status: "connected",
        last_error: null,
        last_sync_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" },
    );
    if (error) throw error;
    await audit({
      action: "google_calendar.connected",
      organizationId: state.organizationId,
      resourceType: "calendar_integration",
      requestId: randomUUID(),
      metadata: { account_email: account.email ?? null },
    });
    return back("/app/settings/google-calendar?connected=1");
  } catch (error) {
    await audit({
      action: "google_calendar.oauth_failed",
      organizationId: state.organizationId,
      requestId: randomUUID(),
      metadata: { error: error instanceof Error ? error.message : "unknown" },
    });
    return back("/app/settings/google-calendar?error=oauth_failed");
  }
}
