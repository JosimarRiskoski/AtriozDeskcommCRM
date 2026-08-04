import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { HumanSupportSettingsClient } from "./HumanSupportSettingsClient";

export const dynamic = "force-dynamic";

export default async function HumanSupportSettingsPage() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org || ROLE_RANK[org.role] < ROLE_RANK.admin) redirect("/app/settings");
  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Atendimento humano</h1>
        <p className="text-sm text-muted-foreground">
          Defina responsáveis, prazos, motivos de transferência e onde os gestores serão avisados.
        </p>
      </header>
      <HumanSupportSettingsClient />
    </div>
  );
}
