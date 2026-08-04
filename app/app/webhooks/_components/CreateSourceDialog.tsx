"use client";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCreateWebhookSource,
  usePipelines,
  usePipelineStages,
  type WebhookSourceRow,
} from "@/hooks/webhooks/useWebhookSources";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (source: WebhookSourceRow) => void;
}

export function CreateSourceDialog({ open, onOpenChange, onCreated }: Props) {
  const [name, setName] = React.useState("");
  const [pipelineId, setPipelineId] = React.useState<string>("");
  const [stageId, setStageId] = React.useState<string>("");
  const [redirectTo, setRedirectTo] = React.useState("");
  const [contract, setContract] = React.useState<"generic" | "3c" | "paid_traffic">("generic");
  const [secret, setSecret] = React.useState("");
  const [createOpportunity, setCreateOpportunity] = React.useState(true);
  const [activateAi, setActivateAi] = React.useState(false);
  const [channelSessionId, setChannelSessionId] = React.useState("");
  const [agentId, setAgentId] = React.useState("");
  const [followupFlowId, setFollowupFlowId] = React.useState("");
  const [externalStateField, setExternalStateField] = React.useState("");
  const [nameAliases, setNameAliases] = React.useState("nome,name");
  const [phoneAliases, setPhoneAliases] = React.useState("telefone,celular,phone,whatsapp");
  const [emailAliases, setEmailAliases] = React.useState("email");
  const [options, setOptions] = React.useState<{
    sessions: Array<{
      id: string;
      display_name: string | null;
      phone_number: string | null;
      status: string;
    }>;
    agents: Array<{ id: string; name: string }>;
    flows: Array<{ id: string; name: string; status: string }>;
  }>({ sessions: [], agents: [], flows: [] });

  const { data: pipelinesRes, isLoading: pipelinesLoading } = usePipelines();
  const { data: boardRes, isLoading: stagesLoading } = usePipelineStages(pipelineId || null);
  const create = useCreateWebhookSource();

  const pipelines = pipelinesRes?.data ?? [];
  const stages = boardRes?.data?.stages ?? [];

  React.useEffect(() => {
    if (!open) {
      setName("");
      setPipelineId("");
      setStageId("");
      setRedirectTo("");
      setContract("generic");
      setSecret("");
      setCreateOpportunity(true);
      setActivateAi(false);
      setChannelSessionId("");
      setAgentId("");
      setFollowupFlowId("");
      setExternalStateField("");
      setNameAliases("nome,name");
      setPhoneAliases("telefone,celular,phone,whatsapp");
      setEmailAliases("email");
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    void Promise.all([
      fetch("/api/v1/channel-sessions").then((response) => response.json()),
      fetch("/api/v1/ai/agents").then((response) => response.json()),
      fetch("/api/v1/ai/followup-flows").then((response) => response.json()),
    ])
      .then(([sessions, agents, flows]) =>
        setOptions({
          sessions: sessions.data ?? [],
          agents: agents.data ?? [],
          flows: flows.data ?? [],
        }),
      )
      .catch(() => undefined);
  }, [open]);

  React.useEffect(() => {
    setStageId("");
  }, [pipelineId]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (createOpportunity && (!pipelineId || !stageId)) {
      toast.error("Escolha o funil e o estágio de entrada.");
      return;
    }
    try {
      const res = await create.mutateAsync({
        name,
        provider_type: contract,
        source_code:
          contract === "3c" ? "3c" : contract === "paid_traffic" ? "trafego_pago" : "webhook",
        require_external_id: contract === "3c",
        create_opportunity: createOpportunity,
        secret: secret || undefined,
        default_pipeline_id: createOpportunity ? pipelineId : null,
        default_stage_id: createOpportunity ? stageId : null,
        default_channel_session_id: channelSessionId || null,
        default_agent_id: agentId || null,
        activate_ai: activateAi,
        followup_flow_id: followupFlowId || null,
        automation_external_state_field: externalStateField || null,
        field_map: {
          name: nameAliases
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          phone: phoneAliases
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          email: emailAliases
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        },
        redirect_to: redirectTo.trim() || undefined,
      });
      toast.success("Fonte criada. Agora é só conectar seu site.");
      onOpenChange(false);
      onCreated(res.data);
    } catch {
      /* erro já mostrado pelo showApiError */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova fonte de captação</DialogTitle>
          <DialogDescription>
            Dê um nome e diga em qual funil o contato deve entrar quando alguém preencher seu
            formulário.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="src-name">Nome</Label>
            <Input
              id="src-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Landing page de Black Friday"
              minLength={1}
              maxLength={120}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Tipo de integração</Label>
            <Select
              value={contract}
              onValueChange={(value) => setContract(value as "generic" | "3c" | "paid_traffic")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="generic">Formulário ou integração genérica</SelectItem>
                <SelectItem value="3c">3C — contrato protegido</SelectItem>
                <SelectItem value="paid_traffic">Tráfego pago — modelo pronto</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              3C exige identificador externo e assinatura, impedindo duplicações e acesso direto ao
              banco.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="src-secret">
              {contract === "3c"
                ? "Credencial compartilhada com a 3C"
                : "Assinatura da integração (opcional)"}
            </Label>
            <Input
              id="src-secret"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              minLength={16}
              required={contract === "3c"}
            />
            <p className="text-xs text-muted-foreground">
              {contract === "3c"
                ? "Obrigatória na 3C. "
                : "Quando preenchida, rejeita eventos sem assinatura válida. "}
              Aparece somente durante a configuração e fica cifrada no servidor.
            </p>
          </div>
          <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              checked={createOpportunity}
              onChange={(event) => setCreateOpportunity(event.target.checked)}
            />
            Criar oportunidade no Kanban
          </label>
          <details className="rounded-md border p-3 text-sm">
            <summary className="cursor-pointer font-medium">
              Mapeamento dos campos recebidos
            </summary>
            <div className="mt-3 grid gap-3">
              <Label>Nomes possíveis para o campo nome</Label>
              <Input value={nameAliases} onChange={(event) => setNameAliases(event.target.value)} />
              <Label>Nomes possíveis para o campo telefone</Label>
              <Input
                value={phoneAliases}
                onChange={(event) => setPhoneAliases(event.target.value)}
              />
              <Label>Nomes possíveis para o campo e-mail</Label>
              <Input
                value={emailAliases}
                onChange={(event) => setEmailAliases(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Separe por vírgulas. O sistema normaliza os dados antes de criar ou atualizar o
                contato.
              </p>
            </div>
          </details>
          {createOpportunity && (
            <>
              <div className="space-y-2">
                <Label>Funil de entrada</Label>
                <Select
                  value={pipelineId}
                  onValueChange={setPipelineId}
                  disabled={pipelinesLoading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha o funil" />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Estágio de entrada</Label>
                <Select
                  value={stageId}
                  onValueChange={setStageId}
                  disabled={!pipelineId || stagesLoading}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={pipelineId ? "Escolha o estágio" : "Escolha o funil primeiro"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          {contract !== "generic" && (
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">Automação opcional</p>
              <p className="text-xs text-muted-foreground">
                A configuração nasce desligada. Um administrador deverá validar o piloto antes de
                ativá-la.
              </p>
              <Label>Conexão usada pela automação</Label>
              <select
                className="w-full rounded-md border bg-background p-2 text-sm"
                value={channelSessionId}
                onChange={(event) => setChannelSessionId(event.target.value)}
              >
                <option value="">Nenhuma</option>
                {options.sessions
                  .filter((session) => session.status === "WORKING")
                  .map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.display_name || session.phone_number || session.id}
                    </option>
                  ))}
              </select>
              <Label>Agente específico</Label>
              <select
                className="w-full rounded-md border bg-background p-2 text-sm"
                value={agentId}
                onChange={(event) => setAgentId(event.target.value)}
              >
                <option value="">Agente padrão</option>
                {options.agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={activateAi}
                  onChange={(event) => setActivateAi(event.target.checked)}
                />{" "}
                Ativar IA quando a automação iniciar
              </label>
              <Label>Cadência publicada</Label>
              <select
                className="w-full rounded-md border bg-background p-2 text-sm"
                value={followupFlowId}
                onChange={(event) => setFollowupFlowId(event.target.value)}
              >
                <option value="">Não iniciar cadência</option>
                {options.flows
                  .filter((flow) => flow.status === "active")
                  .map((flow) => (
                    <option key={flow.id} value={flow.id}>
                      {flow.name}
                    </option>
                  ))}
              </select>
              {contract === "3c" && (
                <>
                  <Label>Campo que indica automação ativa na 3C</Label>
                  <Input
                    value={externalStateField}
                    onChange={(event) => setExternalStateField(event.target.value)}
                    placeholder="automation_status"
                  />
                </>
              )}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="src-redirect">URL de obrigado (opcional)</Label>
            <Input
              id="src-redirect"
              type="url"
              value={redirectTo}
              onChange={(e) => setRedirectTo(e.target.value)}
              placeholder="https://seusite.com/obrigado"
            />
            <p className="text-xs text-muted-foreground">
              Para onde enviar a pessoa depois que ela preencher seu formulário.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending}>
              Criar fonte
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
