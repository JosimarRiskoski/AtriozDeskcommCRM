import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { PipelinesClient, type PipelineRow, type StageRow } from "./_client";
import { BackNavigation } from "@/components/shell/BackNavigation";

export const dynamic = "force-dynamic";

export default async function PipelinesSettingsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!user.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }

  const supabase = await createClient();
  const [{ data }, { data: stageData }] = await Promise.all([
    supabase
      .from("crm_pipelines")
      .select("id, name, slug, vocabulary, settings, is_default, position")
      .eq("organization_id", activeOrg.orgId)
      .eq("is_archived", false)
      .order("position"),
    supabase
      .from("crm_stages")
      .select(
        "id,pipeline_id,name,color,position,is_won,is_lost,requires_human,expected_duration_hours,agent_stage_hint",
      )
      .eq("organization_id", activeOrg.orgId)
      .eq("is_archived", false)
      .order("position"),
  ]);

  const stages = (stageData ?? []) as unknown as StageRow[];
  const pipelines = ((data ?? []) as PipelineRow[]).map((pipeline) => ({
    ...pipeline,
    stages: stages.filter((stage) => stage.pipeline_id === pipeline.id),
  }));

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header className="space-y-3">
        <BackNavigation fallbackHref="/app/settings" label="Voltar às configurações" />
        <h1 className="text-2xl font-semibold tracking-tight">Pipelines</h1>
        <p className="text-sm text-muted-foreground">
          Crie funis, organize etapas, campos e motivos de perda sem editar JSON ou usar SQL.
        </p>
      </header>
      <PipelinesClient pipelines={pipelines} />
    </div>
  );
}
