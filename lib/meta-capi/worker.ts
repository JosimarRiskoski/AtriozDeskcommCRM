import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";
import { normalizedMetaUserData } from "./user-data";

type Admin = SupabaseClient;
export async function runMetaCapiTick(
  admin: Admin,
): Promise<{ claimed: number; sent: number; failed: number; skipped: number }> {
  const out = { claimed: 0, sent: 0, failed: 0, skipped: 0 };
  const { data, error } = await admin.rpc("fn_claim_meta_conversion");
  if (error) throw new Error(error.message);
  const event = Array.isArray(data) ? data[0] : null;
  if (!event) return out;
  out.claimed = 1;
  const { data: setting } = await admin
    .from("meta_capi_settings")
    .select("*")
    .eq("organization_id", event.organization_id)
    .eq("enabled", true)
    .maybeSingle();
  const { data: lead } = await admin
    .from("crm_leads")
    .select(
      "id,value_cents,currency,closed_at,contact_id,contacts:contact_id(phone_number,email,consent,source_metadata)",
    )
    .eq("id", event.lead_id)
    .maybeSingle();
  const contact = lead?.contacts as unknown as {
    phone_number?: string | null;
    email?: string | null;
    consent?: Record<string, unknown> | null;
    source_metadata?: Record<string, unknown> | null;
  } | null;
  if (!event.requested_by_user_id || !event.requested_at) {
    await admin
      .from("meta_conversion_events")
      .update({
        status: "skipped",
        lease_until: null,
        last_error: "manual_confirmation_missing",
        updated_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    out.skipped = 1;
    return out;
  }
  if (!setting || !lead || (setting.require_consent && contact?.consent?.meta_capi !== true)) {
    await admin
      .from("meta_conversion_events")
      .update({
        status: "skipped",
        lease_until: null,
        last_error: !setting ? "settings_disabled" : !lead ? "lead_missing" : "consent_missing",
        updated_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    out.skipped = 1;
    return out;
  }
  const token = await decryptWebhookSecret(admin, setting.access_token_encrypted);
  if (!token) {
    const terminal = Number(event.attempts ?? 1) >= 5;
    await admin
      .from("meta_conversion_events")
      .update({
        status: terminal ? "failed" : "pending",
        lease_until: null,
        next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        last_error: "meta_token_unavailable",
        updated_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    out.failed = 1;
    return out;
  }
  const sourceMetadata = contact?.source_metadata ?? {};
  const userData = normalizedMetaUserData(contact?.phone_number, contact?.email, lead.contact_id, {
    fbc: typeof sourceMetadata.fbc === "string" ? sourceMetadata.fbc : null,
    fbp: typeof sourceMetadata.fbp === "string" ? sourceMetadata.fbp : null,
  });
  if (!Object.keys(userData).length) {
    await admin
      .from("meta_conversion_events")
      .update({
        status: "skipped",
        lease_until: null,
        last_error: "matching_data_missing",
        updated_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    out.skipped = 1;
    return out;
  }
  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: event.event_name,
        event_time: Math.floor(new Date(event.requested_at).getTime() / 1000),
        event_id: event.event_id,
        action_source: "system_generated",
        user_data: userData,
        custom_data: {
          currency: lead.currency || setting.currency,
          value: Number(lead.value_cents ?? 0) / 100,
        },
      },
    ],
  };
  if (setting.test_event_code) payload.test_event_code = setting.test_event_code;
  try {
    const response = await fetch(
      `https://graph.facebook.com/${setting.graph_api_version}/${encodeURIComponent(setting.dataset_id)}/events`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      },
    );
    const json = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(`meta_http_${response.status}:${JSON.stringify(json).slice(0, 300)}`);
    const sentAt = new Date().toISOString();
    const { error: sentError } = await admin
      .from("meta_conversion_events")
      .update({
        status: "sent",
        sent_at: sentAt,
        lease_until: null,
        response_json: json,
        last_error: null,
        updated_at: sentAt,
      })
      .eq("id", event.id);
    if (sentError) {
      if (sentError.code === "23505") {
        await admin
          .from("meta_conversion_events")
          .update({
            status: "skipped",
            lease_until: null,
            last_error: "conversion_already_sent_for_lead",
            updated_at: sentAt,
          })
          .eq("id", event.id);
        out.skipped = 1;
        return out;
      }
      throw sentError;
    }
    await admin.from("api_audit_log").insert({
      action: "meta.conversion_sent",
      actor_user_id: event.requested_by_user_id,
      organization_id: event.organization_id,
      resource_type: "crm_lead",
      resource_id: event.lead_id,
      metadata: {
        event_name: event.event_name,
        event_id: event.event_id,
        test_mode: Boolean(setting.test_event_code),
      },
    });
    out.sent = 1;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const terminal = Number(event.attempts ?? 1) >= 5;
    await admin
      .from("meta_conversion_events")
      .update({
        status: terminal ? "failed" : "pending",
        lease_until: null,
        next_attempt_at: new Date(
          Date.now() + Math.min(60, 2 ** Number(event.attempts ?? 1)) * 60_000,
        ).toISOString(),
        last_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    out.failed = 1;
  }
  return out;
}
