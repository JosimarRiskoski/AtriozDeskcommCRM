"use client";
import { useEffect, useMemo, useState } from "react";
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
import { StepDialogForm } from "@/components/ui/step-dialog-form";
import { ApiError } from "@/lib/api/types";

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

interface ContactOption {
  id: string;
  name: string | null;
  display_name: string | null;
  phone_number: string | null;
  email: string | null;
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
  const [step, setStep] = useState(0);
  const [selectedContactId, setSelectedContactId] = useState(contactId ?? "");
  const [contactSearch, setContactSearch] = useState("");
  const [contactOptions, setContactOptions] = useState<ContactOption[]>([]);
  const [contactMode, setContactMode] = useState<"existing" | "quick">("existing");
  const [quickName, setQuickName] = useState("");
  const [quickPhone, setQuickPhone] = useState("");
  const [creatingContact, setCreatingContact] = useState(false);

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
    setSelectedContactId(contactId ?? "");
    setContactSearch("");
    setContactOptions([]);
    setContactMode("existing");
    setQuickName("");
    setQuickPhone("");
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
  }, [open, contactId, initialTitle, initialStage, form]);

  useEffect(() => {
    if (!open || contactId || contactMode !== "existing" || contactSearch.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/v1/contacts?search=${encodeURIComponent(contactSearch.trim())}&limit=20`,
          { signal: controller.signal },
        );
        const json = (await response.json()) as { data?: ContactOption[] };
        if (response.ok) setContactOptions(json.data ?? []);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setContactOptions([]);
      }
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, contactId, contactMode, contactSearch]);

  async function ensureContact(): Promise<string | null> {
    if (contactId) return contactId;
    if (contactMode === "existing") return selectedContactId || null;
    setCreatingContact(true);
    try {
      const response = await fetch("/api/v1/contacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: quickName.trim(),
          phone_number: quickPhone.trim(),
          source: "manual",
        }),
      });
      const json = (await response.json()) as {
        data?: { id?: string };
        error?: { message?: string };
      };
      if (!response.ok || !json.data?.id) {
        throw new Error(json.error?.message || "Não foi possível criar o contato.");
      }
      setSelectedContactId(json.data.id);
      return json.data.id;
    } finally {
      setCreatingContact(false);
    }
  }

  async function onSubmit(values: FormShape) {
    let effectiveContactId: string | null = null;
    try {
      effectiveContactId = await ensureContact();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar o contato.");
      return;
    }
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
    if (effectiveContactId) payload.contact_id = effectiveContactId;
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
    } catch (error) {
      if (error instanceof ApiError && error.code === "open_opportunity_exists") {
        const existing = error.details?.existing_opportunity as
          | { pipeline_id?: string; title?: string }
          | undefined;
        const existingPipelineId = existing?.pipeline_id ?? pipelineId;
        onOpenChange(false);
        onCreated?.();
        toast.warning("Este contato já tem uma oportunidade aberta.", {
          description: existing?.title,
          action: {
            label: "Abrir oportunidade",
            onClick: () => router.push(`/app/pipelines/${existingPipelineId}`),
          },
        });
      }
      // Demais erros já são exibidos pelo hook.
    }
  }

  const stageId = form.watch("stage_id");

  async function advanceStep() {
    const contactReady = Boolean(
      contactId ||
      (contactMode === "existing" && selectedContactId) ||
      (contactMode === "quick" && quickName.trim().length >= 2 && quickPhone.trim().length >= 8),
    );
    const valid = step === 0 ? (await form.trigger("title")) && contactReady : Boolean(stageId);
    if (step === 0 && !contactReady) {
      toast.error("Selecione um contato ou informe nome e telefone para o cadastro rápido.");
    }
    if (valid) setStep((current) => Math.min(current + 1, 2));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setStep(0);
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            A oportunidade será vinculada automaticamente ao contato desta conversa.
          </DialogDescription>
        </DialogHeader>
        <StepDialogForm
          labels={["Negócio", "Detalhes", "Valores"]}
          currentStep={step}
          onSubmit={(event) => {
            event.preventDefault();
            // Pressionar Enter nas duas primeiras etapas apenas avança. Antes,
            // o submit do <form> podia criar a oportunidade sem confirmação.
            if (step < 2) {
              void advanceStep();
              return;
            }
            void form.handleSubmit(onSubmit)(event);
          }}
          footer={
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={create.isPending}
              >
                Cancelar
              </Button>
              {step > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep((current) => current - 1)}
                  disabled={create.isPending}
                >
                  Voltar
                </Button>
              ) : null}
              {step < 2 ? (
                <Button
                  type="button"
                  onClick={() => void advanceStep()}
                  disabled={create.isPending || creatingContact || (step === 1 && !stageId)}
                >
                  Continuar
                </Button>
              ) : (
                <Button type="submit" disabled={create.isPending || creatingContact || !stageId}>
                  {create.isPending || creatingContact ? "Criando…" : "Confirmar e criar"}
                </Button>
              )}
            </DialogFooter>
          }
        >
          {step === 0 &&
            (contactName || contactPhone || primaryOrigin || originHistory.length > 0) && (
              <div className="bg-muted/30 rounded-md border border-border p-3 text-sm">
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
          {step === 0 && !contactId ? (
            <div className="space-y-3 rounded-md border border-border p-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={contactMode === "existing" ? "default" : "outline"}
                  onClick={() => setContactMode("existing")}
                >
                  Buscar contato
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={contactMode === "quick" ? "default" : "outline"}
                  onClick={() => setContactMode("quick")}
                >
                  Cadastro rápido
                </Button>
              </div>
              {contactMode === "existing" ? (
                <div className="space-y-2">
                  <Label htmlFor="lead-contact-search">Contato existente</Label>
                  <Input
                    id="lead-contact-search"
                    value={contactSearch}
                    onChange={(event) => {
                      setContactSearch(event.target.value);
                      setSelectedContactId("");
                    }}
                    placeholder="Busque por nome, telefone ou e-mail"
                  />
                  {contactOptions.length > 0 ? (
                    <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border p-1">
                      {contactOptions.map((contact) => {
                        const label = contact.name || contact.display_name || contact.phone_number;
                        return (
                          <button
                            key={contact.id}
                            type="button"
                            className={`w-full rounded px-2 py-2 text-left text-sm ${selectedContactId === contact.id ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
                            onClick={() => {
                              setSelectedContactId(contact.id);
                              if (!form.getValues("title").trim() && label)
                                form.setValue("title", label);
                            }}
                          >
                            <span className="block font-medium">{label || "Contato sem nome"}</span>
                            {contact.phone_number ? (
                              <span className="text-xs text-muted-foreground">
                                {contact.phone_number}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : contactSearch.trim().length >= 2 ? (
                    <p className="text-xs text-muted-foreground">Nenhum contato encontrado.</p>
                  ) : null}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="quick-contact-name">Nome</Label>
                    <Input
                      id="quick-contact-name"
                      value={quickName}
                      onChange={(event) => {
                        setQuickName(event.target.value);
                        if (!form.getValues("title").trim())
                          form.setValue("title", event.target.value);
                      }}
                      placeholder="Nome do contato"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="quick-contact-phone">WhatsApp</Label>
                    <Input
                      id="quick-contact-phone"
                      value={quickPhone}
                      onChange={(event) => setQuickPhone(event.target.value)}
                      placeholder="+55 11 99999-8888"
                    />
                  </div>
                </div>
              )}
            </div>
          ) : null}
          {step === 0 && pipelineOptions && pipelineOptions.length > 1 ? (
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
          <div className={step === 0 ? "space-y-2" : "hidden"}>
            <Label htmlFor="title">Título</Label>
            <Input
              id="title"
              placeholder="Ex: Pedido Maria — combo presente"
              {...form.register("title", { required: true, minLength: 2 })}
            />
          </div>

          <div className={step === 0 ? "space-y-2" : "hidden"}>
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

          <div className={step === 0 ? "space-y-2" : "hidden"}>
            <Label htmlFor="next_action">Próxima ação</Label>
            <Input
              id="next_action"
              placeholder="Ex: solicitar a fatura amanhã"
              {...form.register("next_action")}
            />
          </div>

          <div className={step === 1 ? "space-y-2" : "hidden"}>
            <Label htmlFor="internal_note">Observação interna</Label>
            <Textarea
              id="internal_note"
              rows={3}
              placeholder="Informação visível somente para a equipe"
              {...form.register("internal_note")}
            />
          </div>

          <div className={step === 1 ? "space-y-2" : "hidden"}>
            <Label htmlFor="description">Descrição</Label>
            <Textarea
              id="description"
              rows={3}
              placeholder="Contexto, observações, links…"
              {...form.register("description")}
            />
          </div>

          <div className={step === 1 ? "space-y-2" : "hidden"}>
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

          <div className={step === 2 ? "grid gap-3 sm:grid-cols-2" : "hidden"}>
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

          <div className={step === 2 ? "space-y-2" : "hidden"}>
            <Label htmlFor="tagsRaw">Tags (separadas por vírgula)</Label>
            <Input id="tagsRaw" placeholder="vip, recompra" {...form.register("tagsRaw")} />
          </div>
        </StepDialogForm>
      </DialogContent>
    </Dialog>
  );
}
