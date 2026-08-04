import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { CampaignsClient } from "./CampaignsClient";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org || ROLE_RANK[org.role] < ROLE_RANK.manager) redirect("/app/inbox");
  const supabase = await createClient();
  const [{ data: pipelines }, { data: sessions }] = await Promise.all([
    supabase
      .from("crm_pipelines")
      .select("id,name,crm_stages(id,name,position)")
      .eq("organization_id", org.orgId)
      .eq("is_archived", false)
      .order("position"),
    supabase
      .from("channel_sessions")
      .select("id,display_name,phone_number,status,daily_message_limit")
      .eq("organization_id", org.orgId)
      .order("created_at"),
  ]);
  return (
    <CampaignsClient pipelines={(pipelines ?? []) as never} sessions={(sessions ?? []) as never} />
  );
}
