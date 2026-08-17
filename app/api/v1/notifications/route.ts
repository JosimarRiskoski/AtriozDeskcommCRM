import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "notification_events" });
  if (!authz.ok) return authz.response;
  const onlyUnread = req.nextUrl.searchParams.get("status") === "unread";
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 50), 1), 100);
  const supabase = await createClient();
  let eventsQuery = supabase
    .from("notification_events" as never)
    .select(
      "id,category,severity,title,body,action_url,resource_type,resource_id,created_at,resolved_at",
    )
    .eq("organization_id", authz.org.orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (onlyUnread) eventsQuery = eventsQuery.is("resolved_at", null);
  const [{ data: events, error }, { data: prefs }] = await Promise.all([
    eventsQuery,
    supabase
      .from("notification_preferences" as never)
      .select("category,enabled")
      .eq("organization_id", authz.org.orgId)
      .eq("user_id", authz.user.id)
      .eq("channel", "in_app"),
  ]);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  const disabledCategories = new Set(
    ((prefs ?? []) as Array<{ category: string; enabled: boolean }>)
      .filter((pref) => !pref.enabled)
      .map((pref) => pref.category),
  );
  const visibleEvents = (
    (events ?? []) as Array<Record<string, unknown> & { id: string; category: string }>
  ).filter((event) => !disabledCategories.has(event.category));
  const ids = visibleEvents.map((event) => event.id);
  const { data: reads } = ids.length
    ? await supabase
        .from("notification_reads" as never)
        .select("event_id,read_at")
        .eq("user_id", authz.user.id)
        .in("event_id", ids)
    : { data: [] };
  const readMap = new Map(
    ((reads ?? []) as Array<{ event_id: string; read_at: string }>).map((row) => [
      row.event_id,
      row.read_at,
    ]),
  );
  const hydrated = visibleEvents.map((event) => ({
    ...event,
    read_at: readMap.get(event.id) ?? null,
  }));
  const filtered = onlyUnread ? hydrated.filter((event) => !event.read_at) : hydrated;
  return ok(filtered, { requestId, meta: { total: filtered.length } });
}
