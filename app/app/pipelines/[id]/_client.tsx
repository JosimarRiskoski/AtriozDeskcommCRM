"use client";
import { useCallback, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useBoard } from "@/hooks/kanban/useBoard";

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const obj = err as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    if (typeof obj.message === "string") {
      const code = typeof obj.code === "string" ? ` [${obj.code}]` : "";
      return `${obj.message}${code}`;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return "Erro desconhecido";
    }
  }
  return String(err);
}
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { FilterBar } from "@/components/kanban/FilterBar";
import { BulkActionBar } from "@/components/kanban/BulkActionBar";
import { NewLeadDialog } from "@/components/kanban/NewLeadDialog";
import { Button } from "@/components/ui/button";
import { Plus } from "@/lib/ui/icons";
import { Badge } from "@/components/ui/badge";
import type { LeadFilters } from "@/lib/kanban/filters";
import { applyFilters, filtersFromParams, filtersToParams } from "@/lib/kanban/filters";
import { savePipelineStage } from "@/app/actions/settings/managePipelines";

export function PipelinePageClient({
  pipelineId,
  initialName,
  pipelines,
}: {
  pipelineId: string;
  initialName: string;
  pipelines: Array<{ id: string; name: string; is_default: boolean }>;
}) {
  const { data, isLoading, error, pulses, realtimeStatus, seguranca } = useBoard(pipelineId);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const setFilters = useCallback(
    (next: LeadFilters) => {
      const qs = filtersToParams(next);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [changingStages, startChangingStages] = useTransition();

  const filteredLeads = data ? applyFilters(data.leads, filters) : [];

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden p-4 lg:p-6"
      // OBSERVÁVEL de propósito, e é a razão de existir desta linha: "a
      // assinatura morreu" e "nada aconteceu" produzem o MESMO silêncio na
      // tela, e sem este valor nem o produto nem o teste conseguem separar as
      // duas famílias de causa. Com ele, quem investiga olha DURANTE a rodada
      // que falha: `subscribed` manda procurar a montante (entrega, filtro, ou
      // o evento nunca saiu); `channel_error`/`timed_out`/`closed` já é a
      // resposta.
      //
      // Ainda NÃO religa — religar é desenho e merece bloco próprio. Isto aqui
      // é só parar de descartar o que já era calculado.
      data-realtime-status={realtimeStatus.toLowerCase()}
      // A rede de segurança fica OBSERVÁVEL pelo mesmo motivo do status do
      // canal: "a entrega morreu" e "nada aconteceu" têm a mesma aparência, que
      // é silêncio. Aqui o número de divergências é a diferença entre os dois —
      // e é o sinal que faltava para uma verificação poder APROVAR, e não só
      // reprovar.
      data-refetch-divergencias={seguranca.divergencias}
      data-refetch-em={seguranca.ultimaVerificacao ?? ""}
    >
      <header className="flex shrink-0 items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          {data?.pipeline.name ?? initialName}
        </h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={filteredLeads.length === 0}
            onClick={() => setSelectedIds(filteredLeads.map((lead) => lead.id))}
            title="Seleciona os resultados dos filtros atuais para ações coletivas"
          >
            Selecionar resultados ({filteredLeads.length})
          </Button>
          <Button
            variant="outline"
            disabled={!data || changingStages}
            onClick={() =>
              startChangingStages(async () => {
                const result = await savePipelineStage(pipelineId, {
                  name: "Nova etapa",
                  color: "#64748b",
                  requires_human: false,
                  is_won: false,
                  is_lost: false,
                });
                if (result.ok) toast.success("Etapa criada. Clique no nome para editar.");
                else toast.error(result.error);
              })
            }
          >
            <Plus size={16} /> Nova etapa
          </Button>
          <Button onClick={() => setNewOpen(true)} disabled={!data}>
            <Plus size={16} className="mr-2" /> Novo Lead
          </Button>
        </div>
      </header>
      <nav className="flex shrink-0 gap-2 overflow-x-auto" aria-label="Funis disponíveis">
        {pipelines.map((pipeline) => (
          <Button
            key={pipeline.id}
            variant={pipeline.id === pipelineId ? "default" : "outline"}
            size="sm"
            onClick={() => router.push(`/app/pipelines/${pipeline.id}`)}
            className="shrink-0"
          >
            {pipeline.name}
            {pipeline.is_default ? <Badge variant="secondary">Principal</Badge> : null}
          </Button>
        ))}
      </nav>
      {data && (
        <NewLeadDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          pipelineId={pipelineId}
          stages={data.stages}
          valueLabel={
            typeof data.pipeline.settings?.value_label === "string"
              ? data.pipeline.settings.value_label
              : "Valor previsto"
          }
        />
      )}
      <div className="shrink-0">
        <FilterBar filters={filters} onChange={setFilters} leads={data?.leads ?? []} />
      </div>
      {error ? (
        <div className="border-destructive/30 bg-destructive/10 rounded-md border p-4 text-sm">
          Erro ao carregar pipeline: {formatError(error)}
        </div>
      ) : isLoading || !data ? (
        <div className="flex flex-1 animate-pulse items-center justify-center text-muted-foreground">
          Carregando…
        </div>
      ) : (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <KanbanBoard
            pipelineId={pipelineId}
            stages={data.stages}
            leads={filteredLeads}
            pulses={pulses}
            pipeline={data.pipeline}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
          />
        </div>
      )}
      <BulkActionBar
        selectedIds={selectedIds}
        stages={data?.stages ?? []}
        pipelineId={pipelineId}
        onClear={() => setSelectedIds([])}
      />
    </div>
  );
}
