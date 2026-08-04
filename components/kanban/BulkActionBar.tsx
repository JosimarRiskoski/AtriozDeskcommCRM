"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUser } from "@/hooks/auth/AuthProvider";
import { useBulkAction } from "@/hooks/kanban/useBulkAction";
import type { Stage } from "@/lib/kanban/types";
import { useFollowupFlows } from "@/hooks/followup/useFollowupFlows";
import { apiClient } from "@/lib/api/client";

interface BulkActionBarProps {
  selectedIds: string[];
  stages: Stage[];
  pipelineId: string;
  onClear: () => void;
}

export function BulkActionBar({ selectedIds, stages, pipelineId, onClear }: BulkActionBarProps) {
  const user = useUser();
  const bulk = useBulkAction(pipelineId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [followupOpen, setFollowupOpen] = useState(false);
  const [followupFlowId, setFollowupFlowId] = useState("");
  const [followupBusy, setFollowupBusy] = useState(false);
  const [followupPreview, setFollowupPreview] = useState<null | {
    selected: number;
    eligible: number;
    excluded: number;
    excluded_by_reason: Array<{ reason: string; count: number }>;
  }>(null);
  const flows = useFollowupFlows();
  const activeFlows = (flows.data ?? []).filter(
    (flow) => flow.status === "active" && flow.active_version_id,
  );
  const selectedFollowupFlow = activeFlows.find((flow) => flow.id === followupFlowId) ?? null;

  // Esc to clear selection
  useEffect(() => {
    if (selectedIds.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClear();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedIds.length, onClear]);

  if (selectedIds.length === 0) return null;

  const runMove = (stageId: string) => {
    bulk.mutate(
      {
        action: "move",
        lead_ids: selectedIds,
        params: { stage_id: stageId, position_in_stage: 1_000_000 },
      },
      { onSuccess: () => onClear() },
    );
  };

  const runAssign = (ownerId: string | null) => {
    bulk.mutate(
      {
        action: "assign",
        lead_ids: selectedIds,
        params: { owner_user_id: ownerId },
      },
      {
        onSuccess: (res) => {
          const n = res.data.updated_count;
          toast.success(
            ownerId === null
              ? `${n} lead${n > 1 ? "s" : ""} sem responsável.`
              : `${n} lead${n > 1 ? "s" : ""} atribuído${n > 1 ? "s" : ""}.`,
          );
          onClear();
        },
      },
    );
  };

  const runTagAdd = () => {
    const t = tagInput.trim();
    if (!t) return;
    bulk.mutate(
      { action: "tag", lead_ids: selectedIds, params: { add: [t] } },
      {
        onSuccess: () => {
          setTagInput("");
          onClear();
        },
      },
    );
  };

  const runDelete = () => {
    bulk.mutate(
      { action: "delete", lead_ids: selectedIds, params: {} },
      {
        onSuccess: () => {
          setConfirmDelete(false);
          onClear();
        },
      },
    );
  };

  async function previewFollowup(confirm: boolean) {
    if (!followupFlowId) return;
    setFollowupBusy(true);
    try {
      const response = await apiClient.post<{
        data: {
          selected: number;
          eligible: number;
          excluded: number;
          excluded_by_reason: Array<{ reason: string; count: number }>;
          created?: number;
        };
      }>("/api/v1/ai/followups/enrollments/bulk", {
        pointer_id: followupFlowId,
        lead_ids: selectedIds,
        confirm,
      });
      setFollowupPreview(response.data);
      if (confirm) {
        toast.success(`${response.data.created ?? 0} follow-up(s) iniciado(s).`);
        setFollowupOpen(false);
        onClear();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao preparar os follow-ups.");
    } finally {
      setFollowupBusy(false);
    }
  }

  return (
    <>
      <div className="sticky bottom-4 z-30 mx-auto flex w-fit items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 shadow-md">
        <span className="text-sm font-medium">
          {selectedIds.length} selecionado{selectedIds.length > 1 ? "s" : ""}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={bulk.isPending}>
              Mover para…
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Stage</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {stages.map((s) => (
              <DropdownMenuItem key={s.id} onClick={() => runMove(s.id)}>
                {s.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={bulk.isPending}>
              Atribuir a…
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => runAssign(user.id)}>Eu</DropdownMenuItem>
            <DropdownMenuItem onClick={() => runAssign(null)}>Remover responsável</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={bulk.isPending}>
              Tag…
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <div className="flex items-center gap-2 p-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="nova tag"
                className="h-8 w-40"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    runTagAdd();
                  }
                }}
              />
              <Button size="sm" onClick={runTagAdd} disabled={!tagInput.trim()}>
                Adicionar
              </Button>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setFollowupPreview(null);
            setFollowupOpen(true);
          }}
        >
          Iniciar follow-up
        </Button>

        <Button
          size="sm"
          variant="destructive"
          onClick={() => setConfirmDelete(true)}
          disabled={bulk.isPending}
        >
          Excluir
        </Button>

        <Button size="sm" variant="ghost" onClick={onClear}>
          Cancelar
        </Button>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir {selectedIds.length} lead(s)?</DialogTitle>
            <DialogDescription>
              Esta ação remove os leads selecionados. Não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={runDelete} disabled={bulk.isPending}>
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={followupOpen} onOpenChange={setFollowupOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Follow-up coletivo</DialogTitle>
            <DialogDescription>
              Primeiro validamos bloqueios, telefone e follow-ups existentes. Nenhuma mensagem é
              enviada nesta confirmação.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="grid gap-1 text-sm">
              Fluxo publicado
              <select
                className="h-10 rounded-md border bg-background px-3"
                value={followupFlowId}
                onChange={(event) => {
                  setFollowupFlowId(event.target.value);
                  setFollowupPreview(null);
                }}
              >
                <option value="">Escolha um fluxo</option>
                {activeFlows.map((flow) => (
                  <option key={flow.id} value={flow.id}>
                    {flow.name}
                  </option>
                ))}
              </select>
            </label>
            {selectedFollowupFlow ? (
              <div className="bg-muted/30 rounded-md border p-3 text-xs text-muted-foreground">
                <p>
                  <b className="text-foreground">Objetivo:</b>{" "}
                  {selectedFollowupFlow.objective ?? selectedFollowupFlow.name}
                </p>
                <p>
                  {selectedFollowupFlow.steps_count ?? 0} mensagem(ns) · duração{" "}
                  {selectedFollowupFlow.duration_minutes ?? 0} min · primeiro envio em{" "}
                  {selectedFollowupFlow.next_send_minutes ?? 0} min
                </p>
                <p>
                  Agente: {selectedFollowupFlow.agent_name ?? "regra automática"} · conexão:{" "}
                  {selectedFollowupFlow.channel_name ?? "conexão de cada conversa"} · cancelar se
                  responder: {selectedFollowupFlow.cancel_on_reply === false ? "não" : "sim"}
                </p>
              </div>
            ) : null}
            {followupPreview ? (
              <div className="rounded-md border p-3 text-sm">
                <p>
                  <b>{followupPreview.selected}</b> selecionados · <b>{followupPreview.eligible}</b>{" "}
                  elegíveis · <b>{followupPreview.excluded}</b> excluídos
                </p>
                {followupPreview.excluded_by_reason.map((item) => (
                  <p key={item.reason} className="mt-1 text-xs text-muted-foreground">
                    {item.count} · {item.reason}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFollowupOpen(false)}>
              Cancelar
            </Button>
            {!followupPreview ? (
              <Button
                disabled={!followupFlowId || followupBusy}
                onClick={() => previewFollowup(false)}
              >
                Validar seleção
              </Button>
            ) : (
              <Button
                disabled={followupPreview.eligible === 0 || followupBusy}
                onClick={() => previewFollowup(true)}
              >
                Confirmar {followupPreview.eligible} contato(s)
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
