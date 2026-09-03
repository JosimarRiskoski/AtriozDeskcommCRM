"use client";
import { useCallback, useMemo, useState } from "react";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBoard } from "@/hooks/kanban/useBoard";
import { useMoveCard } from "@/hooks/kanban/useMoveCard";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useAtRiskLeads } from "@/hooks/leads/useAtRiskLeads";
import { useReactivations } from "@/hooks/leads/useReactivations";
import { midpoint } from "@/lib/kanban/fractional-indexing";
import { shouldRequestLostReason } from "@/lib/kanban/drop-policy";
import type { Lead } from "@/lib/types/leads";
import type { Pipeline, Stage } from "@/lib/kanban/types";
import { StageColumn } from "./StageColumn";
import { LeadDossier } from "./LeadDossier";
import { LoseLeadDialog } from "./LoseLeadDialog";

interface KanbanBoardProps {
  pipelineId: string;
  /** Optional override: if provided, skips internal useBoard fetch. */
  stages?: Stage[];
  leads?: Lead[];
  pipeline?: Pipeline;
  selectedIds?: string[];
  /**
   * Ids que chegaram por evento remoto, quando o board recebe os dados de fora.
   *
   * Quem assina o realtime é quem chama `useBoard` com o pipeline — e nesta
   * página é o _client, não este componente (aqui `useBoard(null)` fica
   * desligado por causa do `useExternal`). Sem esta prop o pulso nasce no lugar
   * certo e morre na fronteira: o dado vem por prop e o sinal ficava para trás.
   */
  pulses?: Map<string, number>;
  onSelectionChange?: (ids: string[]) => void;
}

function groupLeadsByStage(stages: Stage[], leads: Lead[]): Map<string, Lead[]> {
  const map = new Map<string, Lead[]>();
  for (const stage of stages) map.set(stage.id, []);
  for (const lead of leads) {
    const bucket = map.get(lead.stage_id);
    if (bucket) bucket.push(lead);
  }
  // Already ordered by position_in_stage at fetch time, but be defensive.
  for (const list of map.values()) {
    list.sort((a, b) => a.position_in_stage - b.position_in_stage);
  }
  return map;
}

function BoardSkeleton() {
  return (
    <div
      className="h-full min-h-0 min-w-0 overflow-x-auto overflow-y-hidden pb-2"
      aria-label="Carregando quadro"
    >
      <div className="flex h-full min-w-max gap-3 pr-1">
        {[0, 1, 2].map((c) => (
          <div
            key={c}
            className="bg-surface-muted/40 flex w-[min(18rem,calc(100vw-3rem))] shrink-0 flex-col gap-2 rounded-lg border border-border p-3 sm:w-72"
          >
            <Skeleton className="h-5 w-32" />
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full animate-pulse" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function KanbanBoard({
  pipelineId,
  stages: stagesProp,
  leads: leadsProp,
  pipeline: pipelineProp,
  selectedIds,
  pulses: pulsesProp,
  onSelectionChange,
}: KanbanBoardProps) {
  const useExternal = stagesProp !== undefined && leadsProp !== undefined;
  const queryResult = useBoard(useExternal ? null : pipelineId);
  const moveCard = useMoveCard(pipelineId);
  const { data: members } = useAssignableMembers(true);
  const ownerNames = useMemo(
    () => new Map((members ?? []).map((m) => [m.user_id, m.full_name])),
    [members],
  );
  // Esfriando vem do MESMO radar que alimenta /app/radar — o board não
  // reclassifica nada (contrato §3.3). `em_voo` fica de fora: a IA já prometeu
  // voltar, então não há decisão pendente para o humano.
  const { data: atRisk } = useAtRiskLeads();
  // As propostas vivas vêm da MESMA forma que o risco: uma lista por org, que o
  // card consome sem saber de onde veio. Ver o cabeçalho da rota.
  const { data: propostasVivas } = useReactivations();
  const reactivations = useMemo(() => {
    const m = new Map<string, { proposalId: string; expiresAt: string }>();
    for (const p of propostasVivas ?? []) {
      if (!p.proposal_id || !p.expires_at) continue;
      m.set(p.lead_id, { proposalId: p.proposal_id, expiresAt: p.expires_at });
    }
    return m;
  }, [propostasVivas]);
  const coolingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of atRisk?.items ?? []) {
      if (item.pipeline_id !== pipelineId) continue;
      if (item.risk === "em_risco" || item.risk === "critico") ids.add(item.id);
    }
    return ids;
  }, [atRisk, pipelineId]);
  // A tag canônica do pipeline é a ÚNICA que fica no card (como ponto de 6px);
  // as outras saem para o hover. Já existe em settings — não inventa campo.
  const canonicalTags = useMemo(() => {
    const raw = (pipelineProp ?? queryResult.data?.pipeline)?.settings?.canonical_tags;
    return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : [];
  }, [pipelineProp, queryResult.data?.pipeline]);
  const valueLabel = useMemo(() => {
    const value = (pipelineProp ?? queryResult.data?.pipeline)?.settings?.value_label;
    return typeof value === "string" && value.trim() ? value : "Valor previsto";
  }, [pipelineProp, queryResult.data?.pipeline]);

  // O dossiê é do BOARD e não da página: ele precisa do lead inteiro e do nome
  // do estágio, que só existem aqui depois do agrupamento.
  const [dossieId, setDossieId] = useState<string | null>(null);
  const [pendingLostMove, setPendingLostMove] = useState<{
    leadId: string;
    stageId: string;
  } | null>(null);
  const [internalSelected, setInternalSelected] = useState<Set<string>>(new Set());
  const selectedLeadIds = useMemo(
    () => (selectedIds ? new Set(selectedIds) : internalSelected),
    [selectedIds, internalSelected],
  );

  const data = useExternal
    ? {
        pipeline: pipelineProp ?? ({} as Pipeline),
        stages: stagesProp,
        leads: leadsProp,
      }
    : queryResult.data;
  const isLoading = useExternal ? false : queryResult.isLoading;
  const isError = useExternal ? false : queryResult.isError;
  const error = useExternal ? null : queryResult.error;

  const leadDoDossie = dossieId ? (data?.leads.find((l) => l.id === dossieId) ?? null) : null;

  const grouped = useMemo(() => {
    if (!data) return null;
    return groupLeadsByStage(data.stages, data.leads);
  }, [data]);

  const handleSelect = useCallback(
    (leadId: string, additive: boolean) => {
      const apply = (prev: Set<string>): Set<string> => {
        const next = new Set(additive ? prev : []);
        if (additive && prev.has(leadId)) {
          next.delete(leadId);
        } else {
          next.add(leadId);
        }
        return next;
      };
      if (onSelectionChange) {
        const nextSet = apply(selectedLeadIds);
        onSelectionChange(Array.from(nextSet));
      } else {
        setInternalSelected((prev) => apply(prev));
      }
    },
    [onSelectionChange, selectedLeadIds],
  );

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      if (!data || !grouped) return;
      const { source, destination, draggableId } = result;
      if (!destination) return;
      if (source.droppableId === destination.droppableId && source.index === destination.index) {
        return;
      }

      const lead = data.leads.find((l) => l.id === draggableId);
      if (!lead) return;

      const destStageId = destination.droppableId;
      const destStage = data.stages.find((stage) => stage.id === destStageId);
      if (!destStage) return;

      // Entrar numa etapa de perda exige um motivo pelo contrato do banco.
      // O gesto de arrastar apenas abre a confirmação; o endpoint /lose faz a
      // transição completa depois que o operador escolhe o motivo.
      if (shouldRequestLostReason(lead, destStage)) {
        setPendingLostMove({ leadId: lead.id, stageId: destStage.id });
        return;
      }

      const destList = (grouped.get(destStageId) ?? []).filter((l) => l.id !== draggableId);

      const before = destination.index > 0 ? destList[destination.index - 1] : null;
      const after = destination.index < destList.length ? destList[destination.index] : null;

      const newPosition = midpoint(
        before?.position_in_stage ?? null,
        after?.position_in_stage ?? null,
      );

      moveCard.mutate({
        leadId: lead.id,
        stageId: destStageId,
        // O servidor recebe também o índice e normaliza atomicamente toda a
        // etapa. O valor continua no contrato para compatibilidade durante o
        // deploy, mas deixa de ser a fonte da verdade quando houver colisão.
        positionInStage: Number.isNaN(newPosition) ? (destination.index + 1) * 1000 : newPosition,
        targetIndex: destination.index,
        expectedUpdatedAt: lead.updated_at,
      });
    },
    [data, grouped, moveCard],
  );

  if (isLoading) {
    return <BoardSkeleton />;
  }

  if (isError) {
    return (
      <Card className="m-4 p-6 text-sm text-text-muted">
        Falha ao carregar o board.
        {error instanceof Error ? ` ${error.message}` : null}
      </Card>
    );
  }

  if (!data || !grouped) {
    return null;
  }

  if (data.stages.length === 0) {
    return (
      <Card className="m-4 p-6 text-sm text-text-muted">Nenhum lead nesta pipeline ainda.</Card>
    );
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div
        className="h-full min-h-0 min-w-0 overflow-x-auto overflow-y-auto overscroll-x-contain pb-2"
        role="region"
        aria-label="Etapas do funil. Role horizontalmente para ver todas."
        tabIndex={0}
      >
        <div className="flex min-h-full min-w-max items-start gap-3 pr-1">
          {data.stages.map((stage, stageIndex) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              leads={grouped.get(stage.id) ?? []}
              pipelineId={pipelineId}
              ownerNames={ownerNames}
              coolingIds={coolingIds}
              reactivations={reactivations}
              pulses={pulsesProp ?? queryResult.pulses}
              canonicalTags={canonicalTags}
              valueLabel={valueLabel}
              selectedLeadIds={selectedLeadIds}
              onSelect={handleSelect}
              onOpen={setDossieId}
              stageIndex={stageIndex}
              stageCount={data.stages.length}
            />
          ))}
        </div>
      </div>
      {leadDoDossie && (
        <LeadDossier
          open
          onOpenChange={(v) => !v && setDossieId(null)}
          lead={leadDoDossie}
          pipelineId={pipelineId}
          stageName={data.stages.find((s) => s.id === leadDoDossie.stage_id)?.name ?? "—"}
          ownerNames={ownerNames}
          valueLabel={valueLabel}
        />
      )}
      {pendingLostMove ? (
        <LoseLeadDialog
          open
          onOpenChange={(open) => !open && setPendingLostMove(null)}
          leadId={pendingLostMove.leadId}
          pipelineId={pipelineId}
          targetStageId={pendingLostMove.stageId}
        />
      ) : null}
    </DragDropContext>
  );
}
