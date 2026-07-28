"use server";

import { notificationPrefsSchema, type NotificationPrefsInput } from "@/lib/schemas/settings";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

export type UpdateNotificationPrefsResult =
  | { ok: true }
  | { ok: false; error: string; details?: unknown };

export async function updateNotificationPrefs(
  input: NotificationPrefsInput,
): Promise<UpdateNotificationPrefsResult> {
  const parsed = notificationPrefsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation_failed", details: parsed.error.flatten() };
  }
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) return { ok: false, error: "forbidden_tenant" };
  const supabase = await createClient();
  const { error } = await supabase.from("notification_preferences" as never).upsert(
    parsed.data.prefs.map((pref) => ({
      organization_id: org.orgId,
      user_id: user.id,
      ...pref,
      updated_at: new Date().toISOString(),
    })) as never,
    { onConflict: "organization_id,user_id,category,channel" },
  );
  return error ? { ok: false, error: "save_failed", details: error.message } : { ok: true };
}
