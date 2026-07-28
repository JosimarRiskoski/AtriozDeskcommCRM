import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  notificationPrefsSchema,
} from "@/lib/schemas/settings";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

function defaultEnabled(category: string, channel: string): boolean {
  if (channel === "in_app") return true;
  return ["human_handoff", "whatsapp_disconnected", "ai_failure"].includes(category);
}

export async function GET() {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "notification_preferences" });
  if (!authz.ok) return authz.response;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notification_preferences" as never)
    .select("category,channel,enabled")
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", authz.user.id);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const saved = new Map(
    ((data ?? []) as Array<{ category: string; channel: string; enabled: boolean }>).map((row) => [
      `${row.category}:${row.channel}`,
      row.enabled,
    ]),
  );
  const prefs = NOTIFICATION_CATEGORIES.flatMap((category) =>
    NOTIFICATION_CHANNELS.map((channel) => ({
      category,
      channel,
      enabled: saved.get(`${category}:${channel}`) ?? defaultEnabled(category, channel),
    })),
  );
  return ok(prefs, { requestId });
}

export async function PUT(req: NextRequest) {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "notification_preferences" });
  if (!authz.ok) return authz.response;
  const parsed = notificationPrefsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Preferências inválidas.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const supabase = await createClient();
  const rows = parsed.data.prefs.map((pref) => ({
    organization_id: authz.org.orgId,
    user_id: authz.user.id,
    ...pref,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from("notification_preferences" as never)
    .upsert(rows as never, { onConflict: "organization_id,user_id,category,channel" });
  if (error) return fail("internal_error", error.message, 500, { requestId });
  void audit({
    action: "notification_prefs.changed",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "notification_preferences",
    requestId,
    metadata: { count: rows.length },
  });
  return ok({ saved: true }, { requestId });
}

