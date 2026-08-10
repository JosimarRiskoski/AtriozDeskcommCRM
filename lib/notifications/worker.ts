import type { SupabaseClient } from "@supabase/supabase-js";

import { sendEmail } from "@/lib/email/resend";
import { sendWhatsAppText } from "@/lib/whatsapp/send";
import { DEFAULT_APP_NAME } from "@/lib/branding";

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
  resource_type?: string | null;
  resource_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

type GroupDelivery = {
  id: string;
  event_id: string;
  organization_id: string;
  connection_id: string;
  group_chat_id: string;
  attempts: number;
};

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[char] ?? char,
  );
}

function publicUrl(path: string | null): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  return base && path ? `${base}${path}` : null;
}

function maskedPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  return `${digits.slice(0, 2)}*****${digits.slice(-4)}`;
}

export async function runNotificationDeliveryTick(admin: SupabaseClient, limit = 20) {
  const { error: deadlineError } = await admin.rpc("fn_process_human_case_deadlines");
  if (deadlineError && !/function .* does not exist/i.test(deadlineError.message))
    throw new Error(`human_case_deadline_failed:${deadlineError.message}`);
  const { data, error } = await admin.rpc("fn_claim_notification_deliveries", { p_limit: limit });
  if (error) throw new Error(`notification_claim_failed:${error.message}`);
  const deliveries = (data ?? []) as Delivery[];
  const summary = {
    claimed: deliveries.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    group_claimed: 0,
    group_sent: 0,
    group_skipped: 0,
    group_failed: 0,
  };

  for (const delivery of deliveries) {
    const [{ data: event }, { data: pref }, { data: authUser }, { data: humanSettings }] =
      await Promise.all([
        admin
          .from("notification_events")
          .select("category,severity,title,body,action_url")
          .eq("id", delivery.event_id)
          .maybeSingle(),
        admin
          .from("notification_preferences")
          .select("enabled")
          .eq("organization_id", delivery.organization_id)
          .eq("user_id", delivery.user_id)
          .eq("channel", "email")
          .maybeSingle(),
        admin.auth.admin.getUserById(delivery.user_id),
        admin
          .from("human_support_settings")
          .select("notify_email")
          .eq("organization_id", delivery.organization_id)
          .maybeSingle(),
      ]);
    const row = event as EventRow | null;
    const explicitPref = pref as { enabled?: boolean } | null;
    const globallyDisabled =
      row?.category === "human_handoff" && humanSettings?.notify_email === false;
    if (!row || globallyDisabled || explicitPref?.enabled === false || !authUser?.user?.email) {
      await admin
        .from("notification_deliveries")
        .update({
          status: "skipped",
          lease_until: null,
          last_error: !row
            ? "event_missing"
            : globallyDisabled
              ? "organization_channel_disabled"
              : explicitPref?.enabled === false
                ? "preference_disabled"
                : "recipient_email_missing",
          updated_at: new Date().toISOString(),
        })
        .eq("id", delivery.id);
      summary.skipped += 1;
      continue;
    }
    const url = publicUrl(row.action_url);
    const result = await sendEmail({
      to: authUser.user.email,
      subject: `[${DEFAULT_APP_NAME}] ${row.title}`,
      text: `${row.title}\n\n${row.body}${url ? `\n\nAbrir: ${url}` : ""}`,
      html: `<h2>${escapeHtml(row.title)}</h2><p>${escapeHtml(row.body)}</p>${url ? `<p><a href="${escapeHtml(url)}">Abrir no CRM</a></p>` : ""}`,
      tags: [{ name: "category", value: row.category.slice(0, 256) }],
    });
    if (result.ok) {
      await admin
        .from("notification_deliveries")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          provider_message_id: result.id ?? null,
          lease_until: null,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", delivery.id);
      summary.sent += 1;
    } else {
      const terminal = delivery.attempts >= 5;
      const delayMinutes = Math.min(60, 2 ** Math.max(0, delivery.attempts - 1));
      await admin
        .from("notification_deliveries")
        .update({
          status: "failed",
          lease_until: null,
          last_error: result.error ?? "send_failed",
          next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
          updated_at: new Date().toISOString(),
          ...(terminal
            ? { next_attempt_at: new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString() }
            : {}),
        })
        .eq("id", delivery.id);
      summary.failed += 1;
    }
  }

  const { data: groupRows, error: groupClaimError } = await admin.rpc(
    "fn_claim_whatsapp_group_deliveries",
    { p_limit: Math.min(limit, 10) },
  );
  if (groupClaimError && !/function .* does not exist/i.test(groupClaimError.message))
    throw new Error(`group_notification_claim_failed:${groupClaimError.message}`);
  const groupDeliveries = (groupRows ?? []) as GroupDelivery[];
  summary.group_claimed = groupDeliveries.length;
  for (const delivery of groupDeliveries) {
    const [{ data: event }, { data: connection }, { data: settings }] = await Promise.all([
      admin
        .from("notification_events")
        .select("category,severity,title,body,action_url,resource_type,resource_id,metadata")
        .eq("id", delivery.event_id)
        .maybeSingle(),
      admin
        .from("channel_sessions")
        .select("provider,external_session_name,status")
        .eq("id", delivery.connection_id)
        .eq("organization_id", delivery.organization_id)
        .maybeSingle(),
      admin
        .from("human_support_settings")
        .select("notify_whatsapp_group,group_message_template,group_phone_display")
        .eq("organization_id", delivery.organization_id)
        .maybeSingle(),
    ]);
    const row = event as EventRow | null;
    if (
      !row ||
      !settings?.notify_whatsapp_group ||
      !connection ||
      connection.provider !== "evolution" ||
      !connection.external_session_name ||
      !["WORKING", "connected", "active", "online"].includes(connection.status)
    ) {
      await admin
        .from("whatsapp_group_notification_deliveries")
        .update({
          status: "skipped",
          lease_until: null,
          last_error: !row
            ? "event_missing"
            : !settings?.notify_whatsapp_group
              ? "channel_disabled"
              : "connection_unavailable",
          updated_at: new Date().toISOString(),
        })
        .eq("id", delivery.id);
      summary.group_skipped += 1;
      continue;
    }
    let variables: Record<string, string> = {
      case_id: String(row.metadata?.case_id ?? row.resource_id ?? "—"),
      contact_name: "—",
      contact_phone: "—",
      summary: row.body,
      urgency: String(row.metadata?.urgency ?? row.severity),
      assignee_name: "Fila de atendimento",
      crm_link: publicUrl(row.action_url) ?? "Abra o CRM para ver o caso",
    };
    if (row.resource_type === "agent_case" && row.resource_id) {
      const { data: caseRow } = await admin
        .from("agent_cases")
        .select(
          "summary,urgency,assignee_user_id,conversations:conversation_id(contacts:contact_id(name,phone_number))",
        )
        .eq("id", row.resource_id)
        .maybeSingle();
      const joined = caseRow as unknown as {
        summary?: string;
        urgency?: string;
        assignee_user_id?: string | null;
        conversations?: {
          contacts?: { name?: string | null; phone_number?: string | null } | null;
        } | null;
      } | null;
      let assigneeName = "Fila de atendimento";
      if (joined?.assignee_user_id) {
        const { data: assignee } = await admin.auth.admin.getUserById(joined.assignee_user_id);
        assigneeName = assignee?.user
          ? ((assignee.user.user_metadata?.full_name as string | undefined) ??
            assignee.user.email ??
            assigneeName)
          : assigneeName;
      }
      const rawPhone = joined?.conversations?.contacts?.phone_number ?? "";
      variables = {
        ...variables,
        summary: joined?.summary ?? variables.summary ?? "—",
        urgency: joined?.urgency ?? variables.urgency ?? "normal",
        contact_name: joined?.conversations?.contacts?.name ?? "Contato sem nome",
        contact_phone: rawPhone
          ? settings.group_phone_display === "full"
            ? rawPhone
            : maskedPhone(rawPhone)
          : "Sem telefone",
        assignee_name: assigneeName,
      };
    }
    const template = settings.group_message_template || "{{title}}\n{{summary}}";
    const message = Object.entries({ ...variables, title: row.title }).reduce(
      (text, [key, value]) => text.replaceAll(`{{${key}}}`, value),
      template,
    );
    try {
      const result = await sendWhatsAppText({
        provider: "evolution",
        sessionName: connection.external_session_name,
        chatId: delivery.group_chat_id,
        text: message,
      });
      if (!result) throw new Error("provider_unavailable");
      await admin
        .from("whatsapp_group_notification_deliveries")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          lease_until: null,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", delivery.id);
      summary.group_sent += 1;
    } catch (error) {
      const delayMinutes = Math.min(60, 2 ** Math.max(0, delivery.attempts - 1));
      await admin
        .from("whatsapp_group_notification_deliveries")
        .update({
          status: "failed",
          lease_until: null,
          last_error: error instanceof Error ? error.message : "send_failed",
          next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", delivery.id);
      summary.group_failed += 1;
    }
  }
  return summary;
}

export const notificationWorkerInternals = { escapeHtml, publicUrl };
