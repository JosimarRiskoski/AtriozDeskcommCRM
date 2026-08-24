"use client";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAiUsage, type AiUsageFilters } from "@/hooks/ai/useAiUsage";
import { UsageFilters, type UsageFiltersAgent } from "@/components/ai/UsageFilters";
import { UsageChart } from "@/components/ai/UsageChart";

interface Props {
  agents: UsageFiltersAgent[];
  initial: {
    agent_id?: string;
    invocation_kind?: string;
    from?: string;
    to?: string;
  };
}

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

function StatSkeletons() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-8 w-32" />
        </Card>
      ))}
    </div>
  );
}

function ChartSkeletons() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-card p-4">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-4 h-[200px] w-full" />
        </div>
      ))}
    </div>
  );
}

export function UsageDashboardClient({ agents, initial }: Props) {
  const searchParams = useSearchParams();

  const filters: AiUsageFilters = {
    agent_id: searchParams.get("agent_id") ?? undefined,
    invocation_kind: searchParams.get("invocation_kind") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  };

  const q = useAiUsage(filters);

  if (q.isError) {
    return (
      <div className="flex flex-col gap-6">
        <UsageFilters agents={agents} initial={initial} />
        <Card className="border-destructive/40 space-y-3 p-5">
          <div>
            <p className="font-medium">Não foi possível carregar o uso da IA.</p>
            <p className="text-sm text-muted-foreground">
              O orçamento continua protegido. Tente novamente para consultar as métricas do período.
            </p>
          </div>
          <button
            type="button"
            className="w-fit rounded-md border px-3 py-2 text-sm"
            onClick={() => void q.refetch()}
          >
            Tentar novamente
          </button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <UsageFilters agents={agents} initial={initial} />

      {q.isLoading || !q.data ? (
        <>
          <StatSkeletons />
          <ChartSkeletons />
        </>
      ) : q.data.totals.invocations === 0 ? (
        <Card className="p-5">
          <p className="font-medium">Nenhum uso registrado neste período.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Isso é diferente de uma falha: a consulta terminou corretamente, mas nenhum agente
            executou com os filtros selecionados.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Custo no período" value={brl.format(q.data.totals.cost_cents / 100)} />
            <StatCard
              label="Invocações"
              value={q.data.totals.invocations.toLocaleString("pt-BR")}
            />
            <StatCard
              label="Handoff rate"
              value={`${(q.data.totals.handoff_rate * 100).toFixed(2)}%`}
            />
            <StatCard
              label="p95 latência"
              value={`${q.data.totals.p95_latency_ms.toLocaleString("pt-BR")} ms`}
              hint={`p50 ${q.data.totals.p50_latency_ms.toLocaleString("pt-BR")} ms`}
            />
          </div>

          <UsageChart payload={q.data} />
        </>
      )}
    </div>
  );
}
