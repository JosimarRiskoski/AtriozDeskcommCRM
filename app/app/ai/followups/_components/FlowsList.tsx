"use client";
import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FlowArrow, Plus, Trash } from "@/lib/ui/icons";
import {
  useDeleteFollowupFlow,
  useFollowupFlows,
  type FollowupFlowPointerRow,
} from "@/hooks/followup/useFollowupFlows";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FlowStatusBadge } from "./FlowStatusBadge";
import { NewFlowDialog } from "./NewFlowDialog";

interface Props {
  initialData: FollowupFlowPointerRow[];
  canWrite: boolean;
}

function formatUpdatedAt(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function FlowsList({ initialData, canWrite }: Props) {
  const { data } = useFollowupFlows({ initialData });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [flowToDelete, setFlowToDelete] = useState<FollowupFlowPointerRow | null>(null);
  const deleteFlow = useDeleteFollowupFlow();

  const flows = data ?? [];

  const newFlowButton = (
    <Button onClick={() => setDialogOpen(true)}>
      <Plus size={14} aria-hidden className="mr-2" /> Novo fluxo
    </Button>
  );

  if (flows.length === 0) {
    return (
      <>
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <FlowArrow size={36} aria-hidden className="text-text-muted" />
          <h2 className="font-medium">Nenhum fluxo de follow-up ainda</h2>
          <p className="max-w-sm text-sm text-text-muted">
            Follow-ups reengajam contatos automaticamente após silêncio, mudança de etapa ou fim de
            conversa — sem depender de alguém lembrar de mandar mensagem.
          </p>
          {canWrite && <div className="mt-1">{newFlowButton}</div>}
        </Card>
        {canWrite && <NewFlowDialog open={dialogOpen} onOpenChange={setDialogOpen} />}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {canWrite && <div className="flex justify-end">{newFlowButton}</div>}

      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {flows.map((flow) => (
          <li key={flow.id} className="relative">
            <Link href={`/app/ai/followups/${flow.id}`} className="block h-full">
              <Card className="flex h-full flex-col gap-3 p-4 pr-14 transition-colors hover:border-accent-400">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 flex-1 truncate font-medium" title={flow.name}>
                    {flow.name}
                  </h3>
                  <FlowStatusBadge status={flow.status} />
                </div>
                <dl className="grid grid-cols-2 gap-2 pt-1 text-xs">
                  <div>
                    <dt className="text-text-muted">Versão</dt>
                    <dd className="font-mono">{flow.active_version_id ? "publicada" : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">Handoff</dt>
                    <dd className="font-mono">{flow.handoff_policy}</dd>
                  </div>
                </dl>
                <p className="mt-auto pt-2 text-xs text-text-muted">
                  Atualizado em {formatUpdatedAt(flow.updated_at)}
                </p>
              </Card>
            </Link>
            {canWrite && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-2 top-2 z-10 text-text-muted hover:text-error-fg"
                aria-label={`Excluir fluxo ${flow.name}`}
                title={
                  flow.status === "active" ? "Desative o fluxo antes de excluir" : "Excluir fluxo"
                }
                disabled={flow.status === "active"}
                onClick={() => setFlowToDelete(flow)}
              >
                <Trash size={16} aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ul>

      {canWrite && <NewFlowDialog open={dialogOpen} onOpenChange={setDialogOpen} />}
      <AlertDialog
        open={Boolean(flowToDelete)}
        onOpenChange={(open) => !open && setFlowToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este fluxo?</AlertDialogTitle>
            <AlertDialogDescription>
              O rascunho, as versÃµes publicadas e o histÃ³rico encerrado deste fluxo serÃ£o
              removidos. Follow-ups em andamento impedem a exclusÃ£o por seguranÃ§a.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteFlow.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="hover:bg-destructive/90 bg-destructive text-destructive-foreground"
              disabled={deleteFlow.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!flowToDelete) return;
                void deleteFlow
                  .mutateAsync(flowToDelete.id)
                  .then(() => setFlowToDelete(null))
                  .catch(() => undefined);
              }}
            >
              {deleteFlow.isPending ? "Excluindoâ€¦" : "Excluir fluxo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
