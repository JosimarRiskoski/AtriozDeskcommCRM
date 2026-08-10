import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { AiRunsClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function AiRunsPage() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  if (ROLE_RANK[org.role] < ROLE_RANK.manager) redirect("/403");
  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Execuções da IA</h1>
        <p className="text-sm text-muted-foreground">
          Veja quando a IA respondeu, quando falhou e o que precisa ser corrigido.
        </p>
      </header>
      <AiRunsClient />
    </div>
  );
}
