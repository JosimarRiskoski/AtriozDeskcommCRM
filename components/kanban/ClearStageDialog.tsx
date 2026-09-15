"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CircleNotch, Trash, Warning } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import { clearPipelineStageLeads } from "@/app/actions/settings/managePipelines";

interface ClearStageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stageId: string;
  stageName: string;
  leadCount: number;
  pipelineId: string;
  onSuccess?: () => void;
}

export function ClearStageDialog({
  open,
  onOpenChange,
  stageId,
  stageName,
  leadCount,
  pipelineId,
  onSuccess,
}: ClearStageDialogProps) {
  const router = useRouter();
  const [typedName, setTypedName] = useState("");
  const [isPending, startTransition] = useTransition();

  const isMatch = typedName.trim().toLowerCase() === stageName.trim().toLowerCase();

  function handleClose() {
    if (isPending) return;
    setTypedName("");
    onOpenChange(false);
  }

  function handleConfirm() {
    if (!isMatch || isPending) return;

    startTransition(async () => {
      const result = await clearPipelineStageLeads(pipelineId, stageId, typedName);

      if (!result.ok) {
        toast.error(result.error ?? "Não foi possível limpar a coluna.");
        return;
      }

      const deleted = result.data?.deletedCount ?? leadCount;
      toast.success(
        deleted === 1
          ? "1 negócio foi removido com sucesso."
          : `${deleted} negócios foram removidos com sucesso.`,
      );

      setTypedName("");
      onOpenChange(false);
      router.refresh();
      onSuccess?.();
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) handleClose();
      }}
    >
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader className="space-y-3">
          <AlertDialogTitle className="text-lg font-bold text-foreground">
            Limpar coluna “{stageName}”?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive">
                <Warning size={20} className="mt-0.5 shrink-0 text-destructive" />
                <div className="space-y-1 text-xs leading-relaxed text-destructive/90">
                  <p className="font-semibold text-destructive">Ação destrutiva e irreversível</p>
                  <p>
                    Esta ação excluirá permanentemente todos os{" "}
                    <strong className="font-bold text-destructive">{leadCount}</strong> negócio(s)
                    desta coluna. Os dados de cálculos e contatos vinculados a estes cards serão excluídos do CRM.
                  </p>
                </div>
              </div>

              <div className="space-y-2 pt-1 text-left">
                <Label htmlFor="clear-stage-confirm-input" className="text-xs font-medium text-foreground">
                  Para autorizar a limpeza, digite exatamente{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono font-semibold text-foreground">
                    {stageName}
                  </code>{" "}
                  abaixo:
                </Label>
                <Input
                  id="clear-stage-confirm-input"
                  type="text"
                  placeholder={`Digite "${stageName}" para confirmar`}
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && isMatch && !isPending) {
                      e.preventDefault();
                      handleConfirm();
                    }
                  }}
                  disabled={isPending}
                  autoComplete="off"
                  autoFocus
                  className={cn(
                    "text-sm transition-colors",
                    isMatch
                      ? "border-destructive focus-visible:ring-destructive"
                      : "focus-visible:ring-ring",
                  )}
                />
                <p className="text-[11px] text-muted-foreground">
                  {isMatch ? (
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">
                      ✓ Nome confirmado. O botão de limpeza foi liberado.
                    </span>
                  ) : (
                    <span>A confirmação não diferencia maiúsculas de minúsculas.</span>
                  )}
                </p>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="mt-4 gap-2 sm:gap-0">
          <AlertDialogCancel onClick={handleClose} disabled={isPending}>
            Cancelar
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={!isMatch || isPending}
            className="cursor-pointer font-medium"
          >
            {isPending ? (
              <>
                <CircleNotch size={16} className="mr-2 animate-spin" />
                Limpando coluna...
              </>
            ) : (
              <>
                <Trash size={16} className="mr-2" />
                Sim, Limpar Coluna
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
