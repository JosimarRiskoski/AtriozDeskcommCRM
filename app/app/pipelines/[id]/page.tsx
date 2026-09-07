import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PipelinePageClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function PipelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  // These reads are independent. Starting both together removes one request
  // round trip from the route's critical path without changing its RLS scope
  // or the data returned to the client.
  const [{ data: pipeline }, { data: pipelines }] = await Promise.all([
    supabase.from("crm_pipelines").select("id, name, vocabulary").eq("id", id).maybeSingle(),
    supabase
      .from("crm_pipelines")
      .select("id,name,is_default")
      .eq("is_archived", false)
      .order("position"),
  ]);
  if (!pipeline) notFound();
  return (
    <PipelinePageClient pipelineId={id} initialName={pipeline.name} pipelines={pipelines ?? []} />
  );
}
