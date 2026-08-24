import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { DeploymentChecklistClient } from "./_client";
import { BackNavigation } from "@/components/shell/BackNavigation";

export const dynamic = "force-dynamic";

export default async function DeploymentChecklistPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!user.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) redirect("/403");
  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <BackNavigation fallbackHref="/app/settings" label="Voltar às configurações" />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Implantação do cliente</h1>
        <p className="text-sm text-muted-foreground">
          Complete os itens antes de liberar a operação real.
        </p>
      </header>
      <DeploymentChecklistClient />
    </div>
  );
}
