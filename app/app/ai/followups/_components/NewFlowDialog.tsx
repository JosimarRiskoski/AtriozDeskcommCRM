"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateFollowupFlow, useFollowupFlows } from "@/hooks/followup/useFollowupFlows";
import { FOLLOWUP_PRESETS, type FollowupPresetId } from "@/lib/followup/presets";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewFlowDialog({ open, onOpenChange }: Props) {
  const router = useRouter();
  const defaultPreset = FOLLOWUP_PRESETS[0]!;
  const [name, setName] = useState(defaultPreset.suggestedName);
  const [presetId, setPresetId] = useState<FollowupPresetId>(defaultPreset.id);
  const create = useCreateFollowupFlow();
  const flows = useFollowupFlows();
  const existing = flows.data?.find(
    (flow) =>
      flow.name.trim().toLocaleLowerCase("pt-BR") === name.trim().toLocaleLowerCase("pt-BR"),
  );

  const reset = () => {
    setName(defaultPreset.suggestedName);
    setPresetId(defaultPreset.id);
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (existing) return;
    create.mutate(
      { name: name.trim(), presetId },
      {
        onSuccess: (created) => {
          reset();
          onOpenChange(false);
          router.push(`/app/ai/followups/${created.id}`);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Novo fluxo de follow-up</DialogTitle>
          <DialogDescription>
            Escolha um modelo pronto. Depois você poderá ajustar os intervalos e as mensagens antes
            de publicar.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Modelo</legend>
            <div className="grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {FOLLOWUP_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={cn(
                    "rounded-md border p-3 text-left transition-colors",
                    presetId === preset.id
                      ? "bg-accent/10 border-accent"
                      : "border-border hover:border-border-strong",
                  )}
                  onClick={() => {
                    setPresetId(preset.id);
                    setName(preset.suggestedName);
                  }}
                >
                  <span className="block text-sm font-medium">{preset.name}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {preset.description}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="flow-name">Nome do fluxo</Label>
            <Input
              id="flow-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex: Recuperação de clientes sem resposta"
              maxLength={80}
              required
            />
            {existing ? (
              <div className="space-y-2 rounded-md border border-warning bg-warning-bg p-3 text-sm text-warning-fg">
                <p>Já existe um fluxo com esse nome.</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onOpenChange(false);
                      router.push(`/app/ai/followups/${existing.id}`);
                    }}
                  >
                    Abrir existente
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setName(`${name.trim()} — cópia`)}
                  >
                    Criar uma cópia
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={create.isPending || name.trim().length === 0 || Boolean(existing)}
            >
              {create.isPending ? "Criando…" : "Criar e personalizar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
