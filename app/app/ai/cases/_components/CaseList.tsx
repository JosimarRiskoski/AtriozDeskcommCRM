"use client";
import { useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useCases,
  type CaseFilters,
  type CaseListItem,
  type CaseUrgency,
} from "@/hooks/ai/useCases";
import { useTeamMembers } from "@/hooks/team/useTeamMembers";
import { useAgentsList } from "@/hooks/ai/useAgents";
import { STATUS_BADGE_VARIANT, STATUS_LABEL } from "@/lib/ai/case-copy";
import { Robot } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import { CaseDetail } from "./CaseDetail";

const TABS: Array<{ value: CaseFilters["status"]; label: string }> = [
  { value: "awaiting_human", label: "Aguardando humano" },
  { value: "awaiting_lead", label: "Aguardando cliente" },
  { value: "escalated", label: "Escalados" },
  { value: "resolved", label: "Resolvidos" },
];

export function CaseList() {
  const [filters, setFilters] = useState<CaseFilters>({
    status: "awaiting_human",
    opened_for: "all",
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading } = useCases(filters);
  const { data: membersResponse } = useTeamMembers();
  const { data: agents } = useAgentsList();
  const members = membersResponse?.data.filter((m) => m.can_receive_human_cases) ?? [];
  const update = <K extends keyof CaseFilters>(key: K, value: CaseFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value || undefined }));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Tabs
        value={filters.status}
        onValueChange={(status) => update("status", status as CaseFilters["status"])}
      >
        <TabsList className="h-auto flex-wrap justify-start">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="grid gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect
          label="Responsável"
          value={filters.assignee_user_id ?? ""}
          onChange={(v) => update("assignee_user_id", v || undefined)}
        >
          <option value="">Todos</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.full_name ?? m.email ?? "Membro"}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Urgência"
          value={filters.urgency ?? ""}
          onChange={(v) => update("urgency", (v || undefined) as CaseUrgency | undefined)}
        >
          <option value="">Todas</option>
          <option value="low">Baixa</option>
          <option value="normal">Normal</option>
          <option value="high">Alta</option>
          <option value="critical">Crítica</option>
        </FilterSelect>
        <FilterSelect
          label="Agente de IA"
          value={filters.agent_id ?? ""}
          onChange={(v) => update("agent_id", v || undefined)}
        >
          <option value="">Todos</option>
          {(agents ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Tempo aberto"
          value={filters.opened_for ?? "all"}
          onChange={(v) => update("opened_for", v as CaseFilters["opened_for"])}
        >
          <option value="all">Qualquer tempo</option>
          <option value="overdue">Prazo vencido</option>
          <option value="24h">Mais de 24 horas</option>
          <option value="7d">Mais de 7 dias</option>
        </FilterSelect>
      </div>

      <div className="flex min-h-0 flex-1 gap-6">
        <div className="flex w-full max-w-sm shrink-0 flex-col gap-4">
          {filters.status === "awaiting_human" && data ? (
            <p className="text-xs text-muted-foreground">
              {data.open_count} caso(s) aberto(s) no total
            </p>
          ) : null}
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : !data || data.cases.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
              <Robot size={28} className="text-muted-foreground/60" />
              <p className="text-sm font-medium">
                {data?.open_count === 0 ? "Nenhum caso aberto" : "Nenhum caso nesta fila"}
              </p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Quando a IA precisar de você, o caso aparecerá aqui com resumo e prioridade.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {data.cases.map((item) => (
                <CaseRow
                  key={item.id}
                  item={item}
                  selected={item.id === selectedId}
                  onSelect={() => setSelectedId(item.id)}
                />
              ))}
            </ul>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <CaseDetail caseId={selectedId} />
        </div>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <select
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

function CaseRow({
  item,
  selected,
  onSelect,
}: {
  item: CaseListItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const when = formatDistanceToNowStrict(new Date(item.opened_at), {
    addSuffix: true,
    locale: ptBR,
  });
  const overdue =
    item.first_response_due_at && new Date(item.first_response_due_at).getTime() < Date.now();
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        data-testid="case-item"
        className={cn(
          "flex w-full flex-col items-start gap-1.5 px-4 py-3 text-left transition-colors hover:bg-accent-soft",
          selected && "bg-accent-soft",
        )}
      >
        <div className="flex w-full items-center justify-between gap-2">
          <p className="truncate text-sm font-medium">{item.title}</p>
          <Badge variant={STATUS_BADGE_VARIANT[item.status]}>{STATUS_LABEL[item.status]}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {item.contact_name ?? "Contato sem nome"} · {when}
        </p>
        <div className="flex flex-wrap gap-1">
          <Badge variant={item.urgency === "critical" ? "warning" : "neutral"}>
            {urgencyLabel(item.urgency)}
          </Badge>
          {overdue ? <Badge variant="warning">Prazo vencido</Badge> : null}
          {item.assignee_name ? (
            <Badge variant="neutral">{item.assignee_name}</Badge>
          ) : (
            <Badge variant="warning">Sem responsável</Badge>
          )}
        </div>
      </button>
    </li>
  );
}

function urgencyLabel(value: CaseUrgency) {
  return { low: "Baixa", normal: "Normal", high: "Alta", critical: "Crítica" }[value];
}
