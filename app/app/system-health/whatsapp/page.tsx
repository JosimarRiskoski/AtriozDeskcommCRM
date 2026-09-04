import { redirect } from "next/navigation";

import { BackNavigation } from "@/components/shell/BackNavigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { WhatsAppDiagnosticsClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function WhatsAppDiagnosticsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!user.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/403");

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <BackNavigation fallbackHref="/app/system-health" label="Voltar à saúde do sistema" />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Diagnóstico do WhatsApp</h1>
        <p className="text-sm text-muted-foreground">
          Acompanhe o caminho da mensagem sem expor conteúdo ou telefone: conexão, webhook e Inbox.
        </p>
      </header>
      <WhatsAppDiagnosticsClient />
    </div>
  );
}
