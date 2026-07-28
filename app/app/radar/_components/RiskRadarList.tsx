"use client";
import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useClaimConversation } from "@/hooks/inbox/useClaimConversation";
import { useAtRiskLeads, type AtRiskLead } from "@/hooks/leads/useAtRiskLeads";
import type { RiskBucket } from "@/lib/leads/risk-radar";
import { ArrowRight, CheckCircle, ClockCountdown, PaperPlaneTilt, Warning } from "@/lib/ui/icons";

const RISK_META: Record<
  Exclude<RiskBucket, "em_dia">,
  { label: string; variant: "error" | "warning" | "info" }
> = {
  critico: { label: "Crítico", variant: "error" },
  em_risco: { label: "Em risco", variant: "warning" },
  em_voo: { label: "Em voo", variant: "info" },
};

function coldFor(hours: number): string {
  if (hours < 48) return `parado há ${hours}h`;
  return `parado há ${Math.round(hours / 24)}d`;
}

function followupWhen(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return "agora";
  const hours = Math.round(diffMs / 3_600_000);
  if (hours < 48) return `em ${Math.max(1, hours)}h`;
  return `em ${Math.round(hours / 24)}d`;
}

export function RiskRadarList() {
  const { data, isLoading } = useAtRiskLeads();
  const [filter, setFilter] = useState<"todos" | Exclude<RiskBucket, "em_dia">>("todos");
  const [ownerFilter, setOwnerFilter] = useState("todos");
  const [channelFilter, setChannelFilter] = useState("todos");
  const [ageFilter, setAgeFilter] = useState<"24" | "72" | "168">("24");

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (!data || data.total === 0) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center"
        data-testid="radar-empty"
      >
        <CheckCircle size={28} className="text-success-fg/70" aria-hidden />
        <p className="text-sm font-medium">Nenhuma demanda em risco</p>
        <p className="text-xs text-muted-foreground">
          Toda demanda aberta teve atividade recente ou já tem um retorno agendado.
        </p>
      </div>
    );
  }

  const humanOwners = Array.from(
    new Map(
      data.items
        .filter((lead) => lead.owner_user_id)
        .map((lead) => [lead.owner_user_id!, lead.owner_user_name ?? "Atendente"]),
    ),
  );
  const channels = Array.from(
    new Map(
      data.items
        .filter((lead) => lead.channel_session_id)
        .map((lead) => [lead.channel_session_id!, lead.channel_name ?? "WhatsApp"]),
    ),
  );

  const visibleItems = data.items.filter((lead) => {
    if (filter !== "todos" && lead.risk !== filter) return false;
    if (lead.hours_since_activity < Number(ageFilter)) return false;
    if (ownerFilter === "human" && !(lead.owner_kind === "user" || lead.owner_user_id))
      return false;
    if (ownerFilter === "ai" && !(lead.owner_kind === "ai" || lead.assignee_kind === "ai"))
      return false;
    if (ownerFilter === "none" && (lead.owner_kind || lead.owner_user_id || lead.assignee_kind))
      return false;
    if (ownerFilter.startsWith("user:") && lead.owner_user_id !== ownerFilter.slice(5))
      return false;
    if (channelFilter !== "todos" && lead.channel_session_id !== channelFilter) return false;
    return true;
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="border-error/30 rounded-lg border bg-error-bg p-3">
          <p className="text-sm font-semibold text-error-fg">Crítico</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Parado além do limite da etapa. Abra e defina o próximo passo agora.
          </p>
        </div>
        <div className="border-warning/30 rounded-lg border bg-warning-bg p-3">
          <p className="text-sm font-semibold text-warning-fg">Em risco</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Está esfriando e ainda não possui retorno programado.
          </p>
        </div>
        <div className="border-info/30 rounded-lg border bg-info-bg p-3">
          <p className="text-sm font-semibold text-info-fg">Em voo</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Há retorno automático agendado. Acompanhe sem abordar em duplicidade.
          </p>
        </div>
      </div>

      <div
        className="flex flex-wrap gap-2"
        data-testid="radar-counts"
        aria-label="Filtrar radar por prioridade"
      >
        <Button
          size="sm"
          variant={filter === "todos" ? "default" : "outline"}
          onClick={() => setFilter("todos")}
        >
          Todos ({data.total})
        </Button>
        <Button
          size="sm"
          variant={filter === "critico" ? "default" : "outline"}
          onClick={() => setFilter("critico")}
        >
          Críticos ({data.counts.critico})
        </Button>
        <Button
          size="sm"
          variant={filter === "em_risco" ? "default" : "outline"}
          onClick={() => setFilter("em_risco")}
        >
          Em risco ({data.counts.em_risco})
        </Button>
        <Button
          size="sm"
          variant={filter === "em_voo" ? "default" : "outline"}
          onClick={() => setFilter("em_voo")}
        >
          Em voo ({data.counts.em_voo})
        </Button>
      </div>

      <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className="min-w-52 space-y-1">
          <label className="text-xs font-medium" htmlFor="radar-age">
            Tempo sem atividade
          </label>
          <Select
            value={ageFilter}
            onValueChange={(value) => setAgeFilter(value as typeof ageFilter)}
          >
            <SelectTrigger id="radar-age">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24">Há pelo menos 24 horas</SelectItem>
              <SelectItem value="72">Há pelo menos 3 dias</SelectItem>
              <SelectItem value="168">Há pelo menos 7 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-52 space-y-1">
          <label className="text-xs font-medium" htmlFor="radar-owner">
            Responsável atual
          </label>
          <Select
            value={ownerFilter}
            onValueChange={(value) => setOwnerFilter(value as typeof ownerFilter)}
          >
            <SelectTrigger id="radar-owner">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="human">Atendimento humano</SelectItem>
              <SelectItem value="ai">Agente de IA</SelectItem>
              <SelectItem value="none">Sem responsável</SelectItem>
              {humanOwners.map(([id, name]) => (
                <SelectItem key={id} value={`user:${id}`}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-52 space-y-1">
          <label className="text-xs font-medium" htmlFor="radar-channel">
            Canal de WhatsApp
          </label>
          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger id="radar-channel">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os números</SelectItem>
              {channels.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <ul className="divide-y divide-border rounded-lg border border-border">
        {visibleItems.map((lead) => (
          <RadarRow key={lead.id} lead={lead} />
        ))}
      </ul>
      {visibleItems.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhuma demanda nesta prioridade.
        </p>
      ) : null}
    </div>
  );
}

function RadarRow({ lead }: { lead: AtRiskLead }) {
  const meta = RISK_META[lead.risk as Exclude<RiskBucket, "em_dia">] ?? RISK_META.em_risco;
  const href = lead.conversation_id
    ? `/app/inbox?id=${lead.conversation_id}`
    : `/app/pipelines/${lead.pipeline_id}`;

  const claim = useClaimConversation();
  const qc = useQueryClient();

  // Dono do NEGÓCIO — humano OU agente (0070). Antes desta linha o radar lia só
  // `owner_user_id`, então um lead que a IA trabalha há dezenas de turnos aparecia
  // como "Sem dono" e mandava um humano resgatar o que já estava sendo tocado.
  // A distinção é a MESMA do card (OwnerBadge): geométrica, nunca ícone de robô —
  // uma fonte de verdade para "quem é o dono", em todas as telas.
  const dono =
    lead.owner_kind === "ai"
      ? `Agente: ${lead.owner_agent_name ?? "sem nome"}`
      : lead.owner_user_id || lead.assignee_kind === "user"
        ? lead.owner_user_name
          ? `Atendente: ${lead.owner_user_name}`
          : "Com atendente"
        : lead.assignee_kind === "ai"
          ? "Assistente na conversa"
          : "Sem dono";

  // "Assumir" é tirar da IA e trazer para si: continua valendo enquanto não há
  // dono HUMANO — dono agente não bloqueia o handoff, é justamente o caso dele.
  const ownedByHuman = Boolean(lead.owner_user_id) || lead.assignee_kind === "user";
  const canClaim = Boolean(lead.conversation_id) && !ownedByHuman;

  function handleClaim() {
    if (!lead.conversation_id) return;
    claim.mutate(
      { conversation_id: lead.conversation_id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["leads-at-risk"] });
          toast.success("Você assumiu a demanda");
        },
      },
    );
  }

  return (
    <li
      data-testid="radar-item"
      data-risk={lead.risk}
      className="hover:bg-accent/50 flex items-start gap-2 pr-3 transition-colors"
    >
      <Link href={href} className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3">
        <Badge variant={meta.variant} className="mt-0.5 shrink-0">
          {meta.label}
        </Badge>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{lead.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {lead.contact_name ? <span className="truncate">{lead.contact_name}</span> : null}
            <span className="inline-flex items-center gap-1">
              <ClockCountdown size={13} aria-hidden />
              {coldFor(lead.hours_since_activity)}
            </span>
            <span className="inline-flex items-center gap-1" data-testid="radar-assignee">
              {dono}
            </span>
            {lead.channel_name ? <span>Canal: {lead.channel_name}</span> : null}
          </p>
          {lead.in_flight && lead.next_followup_at ? (
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-info-fg">
              <PaperPlaneTilt size={13} aria-hidden />
              Assistente retorna {followupWhen(lead.next_followup_at)}
            </p>
          ) : (
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-warning-fg">
              <Warning size={13} aria-hidden />
              Sem próximo passo agendado
            </p>
          )}
        </div>
      </Link>
      <div className="flex shrink-0 items-center gap-2 self-center">
        {canClaim ? (
          <Button
            size="sm"
            variant="outline"
            disabled={claim.isPending}
            onClick={handleClaim}
            data-testid="radar-claim"
          >
            Assumir
          </Button>
        ) : null}
        <ArrowRight size={16} className="text-muted-foreground" aria-hidden />
      </div>
    </li>
  );
}
