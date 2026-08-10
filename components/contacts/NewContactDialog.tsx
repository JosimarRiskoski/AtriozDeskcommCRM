"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { contactCreateSchema, type ContactCreate } from "@/lib/schemas/contacts";
import { useCreateContact } from "@/hooks/contacts/useCreateContact";
import { apiClient } from "@/lib/api/client";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useChannelSessions } from "@/hooks/channels/useChannelSessions";
import { useFollowupFlows } from "@/hooks/followup/useFollowupFlows";
import { useStartFollowupEnrollment } from "@/hooks/followup/useFollowupEnrollments";
import type { PipelineRow } from "@/app/api/v1/pipelines/_handler";
import type { BoardData } from "@/lib/kanban/types";
import { StepProgress } from "@/components/ui/step-progress";

interface FormShape {
  name?: string;
  email?: string;
  phone_number?: string;
  cpf?: string;
  tagsRaw?: string;
  source?: string;
  consentGranted?: boolean;
  createOpportunity?: boolean;
  pipelineId?: string;
  startConversation?: boolean;
  channelSessionId?: string;
  firstMessage?: string;
  startFollowup?: boolean;
  followupFlowId?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConversationStarted?: (conversationId: string) => void;
}

export function NewContactDialog({ open, onOpenChange, onConversationStarted }: Props) {
  const router = useRouter();
  const create = useCreateContact();
  const [serverError, setServerError] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  const form = useForm<FormShape>({
    defaultValues: {
      name: "",
      email: "",
      phone_number: "",
      cpf: "",
      tagsRaw: "",
      source: "manual",
      consentGranted: false,
      createOpportunity: false,
      pipelineId: "",
      startConversation: false,
      channelSessionId: "",
      firstMessage: "",
      startFollowup: false,
      followupFlowId: "",
    },
  });
  const pipelines = useQuery({
    queryKey: ["pipelines", "quick-contact"],
    enabled: open,
    queryFn: async () => (await apiClient.get<{ data: PipelineRow[] }>("/api/v1/pipelines")).data,
  });
  const knownTags = useQuery({
    queryKey: ["contact-tag-vocabulary"],
    enabled: open,
    queryFn: async () => (await apiClient.get<{ data: string[] }>("/api/v1/contact-tags")).data,
  });
  const createOpportunity = form.watch("createOpportunity") ?? false;
  const pipelineId =
    form.watch("pipelineId") ||
    pipelines.data?.find((item) => item.is_default)?.id ||
    pipelines.data?.[0]?.id ||
    "";
  const board = useQuery({
    queryKey: ["board", pipelineId],
    enabled: open && createOpportunity && !!pipelineId,
    queryFn: async () =>
      (await apiClient.get<{ data: BoardData }>(`/api/v1/pipelines/${pipelineId}/board`)).data,
  });
  const channels = useChannelSessions({ enabled: open });
  const startConversation = form.watch("startConversation") ?? false;
  const workingChannels = (channels.data ?? []).filter((channel) => channel.status === "WORKING");
  const flows = useFollowupFlows();
  const startFollowupEnrollment = useStartFollowupEnrollment();
  const startFollowup = form.watch("startFollowup") ?? false;
  const activeFlows = (flows.data ?? []).filter(
    (flow) => flow.status === "active" && flow.active_version_id,
  );
  const selectedTags = (form.watch("tagsRaw") ?? "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  const hasIdentifier = Boolean(
    form.watch("email")?.trim() || form.watch("phone_number")?.trim(),
  );

  function addKnownTag(tag: string) {
    if (selectedTags.includes(tag)) return;
    form.setValue("tagsRaw", [...selectedTags, tag].join(", "));
  }

  async function onSubmit(values: FormShape) {
    setServerError(null);
    const tags = (values.tagsRaw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const payload: Record<string, unknown> = {
      source: values.source || "manual",
      consent: values.consentGranted
        ? { status: "granted", granted_at: new Date().toISOString(), source: "manual" }
        : { status: "unknown" },
    };
    if (values.name?.trim()) payload.name = values.name.trim();
    if (values.email?.trim()) payload.email = values.email.trim();
    if (values.phone_number?.trim()) payload.phone_number = values.phone_number.trim();
    if (values.cpf?.trim()) payload.cpf = values.cpf.trim();
    if (tags.length) payload.tags = tags;

    const parsed = contactCreateSchema.safeParse(payload);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setServerError(first?.message ?? "Dados inválidos");
      return;
    }

    try {
      const response = await create.mutateAsync(parsed.data as ContactCreate);
      const contact = response.data.contact;
      if (values.createOpportunity) {
        const targetPipeline = values.pipelineId || pipelineId;
        const firstStage = board.data?.stages.find((stage) => !stage.is_won && !stage.is_lost);
        if (!targetPipeline || !firstStage)
          throw new Error("Escolha um funil com uma etapa ativa.");
        await apiClient.post("/api/v1/leads", {
          pipeline_id: targetPipeline,
          stage_id: firstStage.id,
          title:
            contact.name || contact.display_name || contact.phone_number || "Nova oportunidade",
          contact_id: contact.id,
          source: values.source || "manual",
          tags: [],
          currency: "BRL",
        });
      }
      if (values.startConversation) {
        const started = await apiClient.post<{ data: { conversation_id: string } }>(
          "/api/v1/conversations/start",
          {
            contact_id: contact.id,
            channel_session_id: values.channelSessionId,
            body: values.firstMessage,
          },
        );
        onConversationStarted?.(started.data.conversation_id);
      }
      if (values.startFollowup && values.followupFlowId) {
        await startFollowupEnrollment.mutateAsync({
          pointerId: values.followupFlowId,
          contactId: contact.id,
        });
      }
      toast.success(
        response.data.action === "existing" ? "Contato existente localizado" : "Contato criado",
        {
          action: {
            label: "Completar cadastro",
            onClick: () => router.push(`/app/contacts/${contact.id}`),
          },
        },
      );
      form.reset();
      setStep(0);
      onOpenChange(false);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("API")) {
        toast.error(
          error instanceof Error ? error.message : "Não foi possível concluir o cadastro.",
        );
      }
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setStep(0);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo contato</DialogTitle>
          <DialogDescription>
            Preencha pelo menos um identificador (email ou telefone).
          </DialogDescription>
        </DialogHeader>
        <StepProgress labels={["Contato", "Ações"]} current={step} />
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome</Label>
            <Input id="name" {...form.register("name")} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="source">Origem</Label>
              <select
                id="source"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                {...form.register("source")}
              >
                <option value="manual">Cadastro manual</option>
                <option value="cold_call_manual">Cold call manual</option>
                <option value="cold_call_ai">Cold call com IA</option>
                <option value="paid_traffic">Tráfego pago</option>
                <option value="campaign">Campanha</option>
                <option value="3c">3C</option>
                <option value="webhook">Webhook</option>
              </select>
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <Switch
                checked={form.watch("consentGranted") ?? false}
                onCheckedChange={(checked) => form.setValue("consentGranted", checked)}
              />
              Consentimento registrado
            </label>
          </div>
          <div className={step === 1 ? "space-y-3 rounded-md border p-3" : "hidden"}>
            <label className="flex items-center gap-2 text-sm font-medium">
              <Switch
                checked={createOpportunity}
                onCheckedChange={(checked) => form.setValue("createOpportunity", checked)}
              />
              Criar oportunidade no Kanban
            </label>
            {createOpportunity ? (
              <div className="space-y-2">
                <Label htmlFor="pipelineId">Funil</Label>
                <select
                  id="pipelineId"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={pipelineId}
                  onChange={(event) => form.setValue("pipelineId", event.target.value)}
                >
                  {(pipelines.data ?? []).map((pipeline) => (
                    <option key={pipeline.id} value={pipeline.id}>
                      {pipeline.name}
                      {pipeline.is_default ? " (principal)" : ""}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  A oportunidade será criada na primeira etapa ativa.
                </p>
              </div>
            ) : null}
          </div>
          <div className={step === 1 ? "space-y-3 rounded-md border p-3" : "hidden"}>
            <label className="flex items-center gap-2 text-sm font-medium">
              <Switch
                checked={startFollowup}
                onCheckedChange={(checked) => form.setValue("startFollowup", checked)}
              />
              Iniciar follow-up depois de salvar
            </label>
            <p className="text-xs text-muted-foreground">
              Esta opção começa desmarcada e não é ativada junto com a IA.
            </p>
            {startFollowup ? (
              <div className="space-y-2">
                <Label htmlFor="followupFlowId">Fluxo publicado</Label>
                <select
                  id="followupFlowId"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  {...form.register("followupFlowId", { required: startFollowup })}
                >
                  <option value="">Escolha o fluxo</option>
                  {activeFlows.map((flow) => (
                    <option key={flow.id} value={flow.id}>
                      {flow.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
          <div className={step === 1 ? "space-y-3 rounded-md border p-3" : "hidden"}>
            <label className="flex items-center gap-2 text-sm font-medium">
              <Switch
                checked={startConversation}
                onCheckedChange={(checked) => form.setValue("startConversation", checked)}
              />
              Salvar e iniciar conversa
            </label>
            {startConversation ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="channelSessionId">Número que enviará a mensagem</Label>
                  <select
                    id="channelSessionId"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    {...form.register("channelSessionId", { required: startConversation })}
                  >
                    <option value="">Selecione uma conexão ativa</option>
                    {workingChannels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.display_name || channel.external_session_name}
                        {channel.phone_number ? ` · ${channel.phone_number}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="firstMessage">Primeira mensagem</Label>
                  <Textarea
                    id="firstMessage"
                    rows={3}
                    placeholder="Escreva a mensagem que será enviada pelo WhatsApp"
                    {...form.register("firstMessage", { required: startConversation })}
                  />
                  <p className="text-xs text-muted-foreground">
                    A conversa só será aberta quando esta mensagem for enviada.
                  </p>
                </div>
              </>
            ) : null}
          </div>
          <div className={step === 0 ? "space-y-2" : "hidden"}>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" {...form.register("email")} />
          </div>
          <div className={step === 0 ? "space-y-2" : "hidden"}>
            <Label htmlFor="phone_number">Telefone (E.164)</Label>
            <Input
              id="phone_number"
              placeholder="+5511999998888"
              {...form.register("phone_number")}
            />
          </div>
          <div className={step === 0 ? "space-y-2" : "hidden"}>
            <Label htmlFor="cpf">CPF (opcional)</Label>
            <Input id="cpf" placeholder="00000000000" {...form.register("cpf")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tagsRaw">Tags (separadas por vírgula)</Label>
            <Input id="tagsRaw" placeholder="vip, recompra" {...form.register("tagsRaw")} />
            {(knownTags.data ?? []).length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {knownTags.data!
                  .filter((tag) => !selectedTags.includes(tag))
                  .slice(0, 12)
                  .map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => addKnownTag(tag)}
                      className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-solid hover:text-foreground"
                    >
                      + {tag}
                    </button>
                  ))}
              </div>
            ) : null}
          </div>
          {serverError && <p className="text-sm text-error-fg">{serverError}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Cancelar
            </Button>
            {step === 1 ? (
              <Button type="button" variant="outline" onClick={() => setStep(0)} disabled={create.isPending}>
                Voltar
              </Button>
            ) : null}
            {step === 0 ? (
              <Button type="button" onClick={() => setStep(1)} disabled={!hasIdentifier}>
                Continuar
              </Button>
            ) : null}
            <Button type="submit" className={step === 0 ? "hidden" : undefined} disabled={create.isPending || step === 0}>
              {create.isPending ? "Criando…" : "Criar contato"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
