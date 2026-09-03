"use client";
import { Droppable } from "@hello-pangea/dnd";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  archivePipelineStage,
  movePipelineStage,
  renamePipelineStage,
  savePipelineStage,
} from "@/app/actions/settings/managePipelines";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CaretLeft, CaretRight, Trash } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/types/leads";
import type { Stage } from "@/lib/kanban/types";
import { buildCardInput } from "@/lib/kanban/card-state";
import { shouldShowKanbanOverflowCue } from "@/lib/kanban/overflow-cue";
import { KanbanCard } from "./KanbanCard";

interface StageColumnProps {
  stage: Stage;
  leads: Lead[];
  pipelineId: string;
  /** owner_user_id → nome, resolvido no board. O dono agente vem no lead. */
  ownerNames?: Map<string, string | null>;
  /** ids que o radar classificou como esfriando (fonte única, não recalculada). */
  coolingIds?: Set<string>;
  /** Propostas de retomada vivas, por lead. */
  reactivations?: Map<string, { proposalId: string; expiresAt: string }>;
  /** `settings.canonical_tags` do pipeline — a única tag que fica no card. */
  canonicalTags?: string[];
  selectedLeadIds?: Set<string>;
  /** leadId → quantos eventos remotos já chegaram (muda = pulsa de novo). */
  pulses?: Map<string, number>;
  onSelect?: (leadId: string, additive: boolean) => void;
  /** Abrir o dossiê — atravessa o board até o card, como `pulses`. */
  onOpen?: (leadId: string) => void;
  stageIndex: number;
  stageCount: number;
  valueLabel: string;
}

function formatBRL(cents: number): string {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `R$ ${(cents / 100).toFixed(0)}`;
  }
}

export function StageColumn({
  stage,
  leads,
  pipelineId,
  ownerNames,
  coolingIds,
  reactivations,
  canonicalTags,
  selectedLeadIds,
  pulses,
  onSelect,
  onOpen,
  stageIndex,
  stageCount,
  valueLabel,
}: StageColumnProps) {
  const cardsScrollerRef = useRef<HTMLDivElement | null>(null);
  const [showOverflowCue, setShowOverflowCue] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(stage.name);
  const [stageColor, setStageColor] = useState(stage.color ?? "#3b82f6");
  const [savingName, startSavingName] = useTransition();
  const totalCents = leads.reduce((sum, l) => sum + (l.value_cents ?? 0), 0);
  const accentStyle: CSSProperties = { backgroundColor: stageColor };
  const cardAccent = stageColor;

  const updateOverflowCue = useCallback(() => {
    const scroller = cardsScrollerRef.current;
    if (!scroller) return;

    setShowOverflowCue(
      shouldShowKanbanOverflowCue({
        scrollTop: scroller.scrollTop,
        clientHeight: scroller.clientHeight,
        scrollHeight: scroller.scrollHeight,
      }),
    );
  }, []);

  useEffect(() => {
    const scroller = cardsScrollerRef.current;
    if (!scroller) return;

    updateOverflowCue();
    const observer = new ResizeObserver(updateOverflowCue);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [leads.length, updateOverflowCue]);

  function saveColor(color: string) {
    const previous = stageColor;
    setStageColor(color);
    startSavingName(async () => {
      const result = await savePipelineStage(pipelineId, {
        id: stage.id,
        name: stage.name,
        color,
        requires_human: false,
        is_won: stage.is_won,
        is_lost: stage.is_lost,
      });
      if (result.ok) toast.success("Cor da etapa atualizada.");
      else {
        setStageColor(previous);
        toast.error(result.error);
      }
    });
  }

  function saveName() {
    const name = nameDraft.trim();
    if (!name || name === stage.name) {
      setNameDraft(stage.name);
      setEditingName(false);
      return;
    }
    startSavingName(async () => {
      const result = await renamePipelineStage(pipelineId, stage.id, name);
      if (result.ok) {
        toast.success("Nome da etapa atualizado.");
        setEditingName(false);
      } else {
        toast.error(result.error);
        setNameDraft(stage.name);
      }
    });
  }

  function runStageAction(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startSavingName(async () => {
      const result = await action();
      if (result.ok) toast.success(success);
      else toast.error(result.error ?? "Não foi possível alterar a etapa.");
    });
  }

  return (
    <section
      className="bg-surface-muted/40 group flex h-full min-h-0 w-[min(18rem,calc(100vw-3rem))] shrink-0 flex-col overflow-hidden rounded-lg border border-border sm:w-72"
      aria-labelledby={`kanban-stage-${stage.id}`}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <label className="relative h-4 w-4 shrink-0 cursor-pointer" title="Alterar cor da etapa">
          <span className="pointer-events-none absolute inset-1 rounded-full" style={accentStyle} />
          <input
            type="color"
            value={stageColor}
            onChange={(event) => saveColor(event.target.value)}
            disabled={savingName}
            aria-label={`Alterar cor da etapa ${stage.name}`}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        {editingName ? (
          <Input
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={saveName}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveName();
              if (event.key === "Escape") {
                setNameDraft(stage.name);
                setEditingName(false);
              }
            }}
            disabled={savingName}
            className="h-7 flex-1 text-sm"
            aria-label="Editar nome da etapa"
            autoFocus
          />
        ) : (
          <button
            id={`kanban-stage-${stage.id}`}
            type="button"
            className="flex-1 truncate text-left text-sm font-semibold text-text hover:underline"
            title="Clique para editar o nome desta etapa"
            onClick={() => setEditingName(true)}
          >
            {stage.name}
          </button>
        )}
        <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium tabular-nums text-text-muted">
          {leads.length}
        </span>
        <div className="flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={savingName || stageIndex === 0}
            onClick={() =>
              runStageAction(() => movePipelineStage(pipelineId, stage.id, -1), "Etapa movida.")
            }
            aria-label="Mover etapa para a esquerda"
          >
            <CaretLeft size={14} />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={savingName || stageIndex === stageCount - 1}
            onClick={() =>
              runStageAction(() => movePipelineStage(pipelineId, stage.id, 1), "Etapa movida.")
            }
            aria-label="Mover etapa para a direita"
          >
            <CaretRight size={14} />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={savingName || leads.length > 0 || stageCount <= 1}
            title={
              leads.length > 0 ? "Mova os negócios antes de arquivar esta etapa" : "Arquivar etapa"
            }
            onClick={() => {
              if (window.confirm(`Arquivar a etapa “${stage.name}”?`))
                runStageAction(
                  () => archivePipelineStage(pipelineId, stage.id),
                  "Etapa arquivada.",
                );
            }}
            aria-label="Arquivar etapa"
          >
            <Trash size={14} />
          </Button>
        </div>
      </div>

      {totalCents > 0 && (
        <div className="border-b border-border px-3 py-1.5 text-[11px] tabular-nums text-text-muted">
          {formatBRL(totalCents)}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <Droppable droppableId={stage.id} type="LEAD">
          {(provided, snapshot) => (
            <div
              ref={(node) => {
                provided.innerRef(node);
                cardsScrollerRef.current = node;
              }}
              {...provided.droppableProps}
              onScroll={updateOverflowCue}
              className={cn(
                "flex h-full min-h-0 flex-col gap-2 overflow-y-auto overscroll-y-contain p-2 pr-1.5 transition-colors",
                snapshot.isDraggingOver && "bg-accent/5",
              )}
            >
            {leads.map((lead, idx) => (
              <KanbanCard
                key={lead.id}
                card={buildCardInput(lead, {
                  stageName: stage.name,
                  ownerNames,
                  coolingIds,
                  reactivations,
                  canonicalTags,
                  valueLabel,
                })}
                stageColor={cardAccent}
                lead={lead}
                index={idx}
                pipelineId={pipelineId}
                isSelected={selectedLeadIds?.has(lead.id)}
                pulseCount={pulses?.get(lead.id) ?? 0}
                onSelect={onSelect}
                onOpen={onOpen}
              />
            ))}
            {provided.placeholder}
            {leads.length === 0 && !snapshot.isDraggingOver && (
              <div className="text-text-muted/70 flex h-20 items-center justify-center text-[11px]">
                vazio
              </div>
            )}
            </div>
          )}
        </Droppable>
        {showOverflowCue && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-12 items-end justify-center bg-gradient-to-t from-surface-muted/95 via-surface-muted/70 to-transparent pb-1 text-[10px] font-medium text-text-muted">
            Role para ver os demais negócios ↓
          </div>
        )}
      </div>
    </section>
  );
}
