import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { SystemHealthClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function SystemHealthPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!user.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Saúde do sistema</h1>
        <p className="text-sm text-muted-foreground">
          Veja o que está funcionando, o que exige atenção e onde corrigir.
        </p>
      </header>
      <SystemHealthClient />
    </div>
  );
}
