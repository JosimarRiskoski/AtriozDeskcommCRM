import { redirect } from "next/navigation";
import { Kanban } from "@/lib/ui/icons";
import { EmptyPipeline } from "@/components/empty";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function KanbanPickerPage() {
  const supabase = await createClient();
  const { data: pipelines } = await supabase
    .from("crm_pipelines")
    .select("id, name, slug, is_default, description")
    .eq("is_archived", false)
    .order("position");

  const list = pipelines ?? [];

  const preferred = list.find((pipeline) => pipeline.is_default) ?? list[0];
  if (preferred) redirect(`/app/pipelines/${preferred.id}`);

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex items-center gap-3">
        <Kanban size={28} className="text-muted-foreground" weight="duotone" />
        <h1 className="text-2xl font-semibold tracking-tight">Pipelines</h1>
      </header>

      {list.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyPipeline primary={{ label: "Ir para Configurações", href: "/app/settings" }} />
        </div>
      ) : null}
    </div>
  );
}
