"use server";

import { redirect } from "next/navigation";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { getGoogleCalendarConfig } from "@/lib/calendar/config";
import { buildGoogleAuthorizeUrl } from "@/lib/calendar/google";
import { issueCalendarState } from "@/lib/calendar/state";

export type ConnectGoogleCalendarResult =
  | { ok: false; error: "auth_required" | "no_active_org" | "forbidden" | "not_configured" };

export async function connectGoogleCalendar(): Promise<ConnectGoogleCalendarResult> {
  const user = await loadAuthUser();
  if (!user) return { ok: false, error: "auth_required" };
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return { ok: false, error: "no_active_org" };
  if (activeOrg.role !== "admin" && !user.is_platform_admin) {
    return { ok: false, error: "forbidden" };
  }
  const config = getGoogleCalendarConfig();
  if (!config) return { ok: false, error: "not_configured" };
  redirect(buildGoogleAuthorizeUrl(config, issueCalendarState(activeOrg.orgId)));
}
