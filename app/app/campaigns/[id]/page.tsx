import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { CampaignDetailClient } from "./CampaignDetailClient";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org || ROLE_RANK[org.role] < ROLE_RANK.manager) redirect("/app/inbox");
  const { id } = await params;
  return <CampaignDetailClient campaignId={id} />;
}
