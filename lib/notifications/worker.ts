import type { SupabaseClient } from "@supabase/supabase-js";

import { sendEmail } from "@/lib/email/resend";

type Delivery = {
  id: string;
  event_id: string;
  organization_id: string;
  user_id: string;
  attempts: number;
};

type EventRow = {
  category: string;
  severity: string;
  title: string;
  body: string;
  action_url: string | null;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char] ?? char);
}

function publicUrl(path: string | null): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  return base && path ? `${base}${path}` : null;
}

export async function runNotificationDeliveryTick(admin: SupabaseClient, limit = 20) {
  const { data, error } = await admin.rpc("fn_claim_notification_deliveries", { p_limit: limit });
  if (error) throw new Error(`notification_claim_failed:${error.message}`);
  const deliveries = (data ?? []) as Delivery[];
  const summary = { claimed: deliveries.length, sent: 0, skipped: 0, failed: 0 };

  for (const delivery of deliveries) {
    const [{ data: event }, { data: pref }, { data: authUser }] = await Promise.all([
      admin.from("notification_events").select("category,severity,title,body,action_url").eq("id", delivery.event_id).maybeSingle(),
      admin.from("notification_preferences").select("enabled").eq("organization_id", delivery.organization_id).eq("user_id", delivery.user_id).eq("channel", "email").maybeSingle(),
      admin.auth.admin.getUserById(delivery.user_id),
    ]);
    const row = event as EventRow | null;
    const explicitPref = pref as { enabled?: boolean } | null;
    if (!row || explicitPref?.enabled === false || !authUser?.user?.email) {
      await admin.from("notification_deliveries").update({ status: "skipped", lease_until: null, last_error: !row ? "event_missing" : explicitPref?.enabled === false ? "preference_disabled" : "recipient_email_missing", updated_at: new Date().toISOString() }).eq("id", delivery.id);
      summary.skipped += 1;
      continue;
    }
    const url = publicUrl(row.action_url);
    const result = await sendEmail({
      to: authUser.user.email,
      subject: `[DeskcommCRM] ${row.title}`,
      text: `${row.title}\n\n${row.body}${url ? `\n\nAbrir: ${url}` : ""}`,
      html: `<h2>${escapeHtml(row.title)}</h2><p>${escapeHtml(row.body)}</p>${url ? `<p><a href="${escapeHtml(url)}">Abrir no CRM</a></p>` : ""}`,
      tags: [{ name: "category", value: row.category.slice(0, 256) }],
    });
    if (result.ok) {
      await admin.from("notification_deliveries").update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: result.id ?? null, lease_until: null, last_error: null, updated_at: new Date().toISOString() }).eq("id", delivery.id);
      summary.sent += 1;
    } else {
      const terminal = delivery.attempts >= 5;
      const delayMinutes = Math.min(60, 2 ** Math.max(0, delivery.attempts - 1));
      await admin.from("notification_deliveries").update({ status: "failed", lease_until: null, last_error: result.error ?? "send_failed", next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(), updated_at: new Date().toISOString(), ...(terminal ? { next_attempt_at: new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString() } : {}) }).eq("id", delivery.id);
      summary.failed += 1;
    }
  }
  return summary;
}

export const notificationWorkerInternals = { escapeHtml, publicUrl };

