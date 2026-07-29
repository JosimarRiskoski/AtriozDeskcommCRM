import { redirect } from "next/navigation";

import { BackNavigation } from "@/components/shell/BackNavigation";
import { readOrganizationPalette } from "@/lib/appearance";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { AppearanceSettings } from "./_form";

export const dynamic = "force-dynamic";

export default async function AppearanceSettingsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", activeOrg.orgId)
    .maybeSingle();
  const canChangeOrganization =
    user.is_platform_admin || ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin;

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header className="space-y-3">
        <BackNavigation fallbackHref="/app/settings" label="Voltar às configurações" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Aparência</h1>
          <p className="text-sm text-muted-foreground">
            Escolha seu tema e a identidade visual do CRM. A prévia é aplicada imediatamente.
          </p>
        </div>
      </header>
      <AppearanceSettings
        initialOrganizationPalette={readOrganizationPalette(data?.settings)}
        canChangeOrganization={canChangeOrganization}
      />
    </div>
  );
}
