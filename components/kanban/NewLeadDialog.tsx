"use client";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateLead } from "@/hooks/kanban/useCreateLead";
import type { Stage } from "@/lib/kanban/types";
import { createLeadSchema, type CreateLeadInput } from "@/lib/schemas/leads";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";

interface FormShape {
  title: string;
  description: string;
  stage_id: string;
  valueReais: string;
  tagsRaw: string;
  expected_close_date: string;
  owner_user_id: string;
  next_action: string;
  internal_note: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pipelineId: string;
  stages: Stage[];
  valueLabel?: string;
  contactId?: string | null;
  conversationId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  primaryOrigin?: string | null;
  originHistory?: string[];
  initialTitle?: string;
  source?: string;
  dialogTitle?: string;
  pipelineOptions?: Array<{ id: string; name: string }>;
  onPipelineChange?: (pipelineId: string) => void;
  onCreated?: () => void;
}

function defaultStageId(stages: Stage[]): string {
  const open = stages.find((s) => !s.is_won && !s.is_lost && !s.is_archived);
  return open?.id ?? stages[0]?.id ?? "";
}

export function NewLeadDialog({
  open,
  onOpenChange,
  pipelineId,
  stages,
  valueLabel = "Valor previsto",
  contactId = null,
  conversationId = null,
  contactName = null,
  contactPhone = null,
  primaryOrigin = null,
  originHistory = [],
  initialTitle = "",
  source = "manual",
  dialogTitle = "Nova oportunidade",
  pipelineOptions,
  onPipelineChange,
  onCreated,
}: Props) {
  const router = useRouter();
  const create = useCreateLead(pipelineId);
  const members = useAssignableMembers(open);
  const initialStage = useMemo(() => defaultStageId(stages), [stages]);

  const form = useForm<FormShape>({
    defaultValues: {
      title: "",
      description: "",
      stage_id: initialStage,
      valueReais: "",
      tagsRaw: "",
      expected_close_date: "",
      owner_user_id: "none",
      next_action: "",
      internal_note: "",
    },
  });

  // Reset stage_id default if stages change while dialog mounted.
  useEffect(() => {
    if (!form.getValues("stage_id") && initialStage) {
      form.setValue("stage_id", initialStage);
    }
  }, [initialStage, form]);

  useEffect(() => {
    if (!open) return;
    form.reset({
      title: initialTitle,
      description: "",
      stage_id: initialStage,
      valueReais: "",
      tagsRaw: "",
      expected_close_date: "",
      owner_user_id: "none",
      next_action: "",
      internal_note: "",
    });
  }, [open, initialTitle, initialStage, form]);

  async function onSubmit(values: FormShape) {
    const tags = values.tagsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const reais = values.valueReais.trim();
    let valueCents: number | null = null;
    if (reais.length > 0) {
      const normalized = reais.replace(/\./g, "").replace(",", ".");
      const n = Number(normalized);
      if (!Number.isFinite(n) || n < 0) {
        form.setError("valueReais", { message: "Valor inválido" });
        return;
      }
      valueCents = Math.round(n * 100);
    }

    const payload: Record<string, unknown> = {
      pipeline_id: pipelineId,
      stage_id: values.stage_id,
      title: values.title.trim(),
      currency: "BRL",
      source,
      tags,
    };
    if (contactId) payload.contact_id = contactId;
    if (conversationId) payload.conversation_id = conversationId;
    if (values.owner_user_id !== "none") payload.owner_user_id = values.owner_user_id;
    if (values.next_action.trim()) payload.next_action = values.next_action.trim();
    if (values.internal_note.trim()) payload.internal_note = values.internal_note.trim();
    if (values.description.trim()) payload.description = values.description.trim();
    if (valueCents !== null) payload.value_cents = valueCents;
    if (values.expected_close_date) payload.expected_close_date = values.expected_close_date;

    const parsed = createLeadSchema.safeParse(payload);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(first?.message ?? "Dados inválidos");
      return;
    }

    try {
      await create.mutateAsync(parsed.data as CreateLeadInput);
      const stageName = stages.find((stage) => stage.id === values.stage_id)?.name;
      const pipelineName = pipelineOptions?.find((pipeline) => pipeline.id === pipelineId)?.name;
      toast.success(
        `Oportunidade criada${pipelineName ? ` em ${pipelineName}` : ""}${stageName ? ` · ${stageName}` : ""}`,
        {
          action: {
            label: "Ver no Kanban",
            onClick: () => router.push(`/app/pipelines/${pipelineId}`),
          },
        },
      );
      form.reset({
        title: "",
        description: "",
        stage_id: initialStage,
        valueReais: "",
        tagsRaw: "",
        expected_close_date: "",
        owner_user_id: "none",
        next_action: "",
        internal_note: "",
      });
      onOpenChange(false);
      onCreated?.();
    } catch {
      // toast already shown
    }
  }

  const stageId = form.watch("stage_id");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            A oportunidade será vinculada automaticamente ao contato desta conversa.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {(contactName || contactPhone || primaryOrigin || originHistory.length > 0) && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{contactName || "Contato sem nome"}</div>
              {contactPhone ? (
                <div className="text-xs text-muted-foreground">{contactPhone}</div>
              ) : null}
              {primaryOrigin ? (
                <div className="mt-2 text-xs">
                  <span className="text-muted-foreground">Origem principal: </span>
                  {primaryOrigin}
                </div>
              ) : null}
              {originHistory.length > 0 ? (
                <div className="mt-1 text-xs">
                  <span className="text-muted-foreground">Histórico: </span>
                  {originHistory.join(" · ")}
                </div>
              ) : null}
            </div>
          )}
          {pipelineOptions && pipelineOptions.length > 1 ? (
            <div className="space-y-2">
              <Label>Funil</Label>
              <Select value={pipelineId} onValueChange={(value) => onPipelineChange?.(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o funil" />
                </SelectTrigger>
                <SelectContent>
                  {pipelineOptions.map((pipeline) => (
                    <SelectItem key={pipeline.id} value={pipeline.id}>
                      {pipeline.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="title">Título</Label>
            <Input
              id="title"
              placeholder="Ex: Pedido Maria — combo presente"
              {...form.register("title", { required: true, minLength: 2 })}
            />
          </div>

          <div className="space-y-2">
            <Label>Responsável</Label>
            <Select
              value={form.watch("owner_user_id")}
              onValueChange={(value) => form.setValue("owner_user_id", value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sem responsável" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem responsável</SelectItem>
                {(members.data ?? []).map((member) => (
                  <SelectItem key={member.user_id} value={member.user_id}>
                    {member.full_name || member.user_id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="next_action">Próxima ação</Label>
            <Input
              id="next_action"
              placeholder="Ex: solicitar a fatura amanhã"
              {...form.register("next_action")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="internal_note">Observação interna</Label>
            <Textarea
              id="internal_note"
              rows={3}
              placeholder="Informação visível somente para a equipe"
              {...form.register("internal_note")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descrição</Label>
            <Textarea
              id="description"
              rows={3}
              placeholder="Contexto, observações, links…"
              {...form.register("description")}
            />
          </div>

          <div className="space-y-2">
            <Label>Etapa</Label>
            <Select value={stageId} onValueChange={(v) => form.setValue("stage_id", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a etapa" />
              </SelectTrigger>
              <SelectContent>
                {stages
                  .filter((s) => !s.is_archived)
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="valueReais">{valueLabel} (R$)</Label>
              <Input
                id="valueReais"
                inputMode="decimal"
                placeholder="0,00"
                {...form.register("valueReais")}
              />
              {form.formState.errors.valueReais && (
                <p className="text-xs text-error-fg">{form.formState.errors.valueReais.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="expected_close_date">Fechamento previsto</Label>
              <Input
                id="expected_close_date"
                type="date"
                {...form.register("expected_close_date")}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tagsRaw">Tags (separadas por vírgula)</Label>
            <Input id="tagsRaw" placeholder="vip, recompra" {...form.register("tagsRaw")} />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending || !stageId}>
              {create.isPending ? "Criando…" : "Criar oportunidade"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
