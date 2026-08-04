"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

type Rule = {
  id: string;
  name: string;
  agent_id: string;
  channel_session_id: string | null;
  contact_source: string | null;
  stage_id: string | null;
  allow_stage_switch: boolean;
  priority: number;
  is_active: boolean;
};
type Lookup = {
  rules: Rule[];
  agents: Array<{ id: string; name: string; published_version_id: string | null }>;
  channels: Array<{
    id: string;
    display_name: string | null;
    phone_number: string | null;
    waha_session_name: string;
  }>;
  stages: Array<{
    id: string;
    name: string;
    crm_pipelines: { name: string } | Array<{ name: string }> | null;
  }>;
};
const embedded = <T,>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : value;

export function AgentAssignmentRules({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["ai-agent-assignment-rules"],
    queryFn: async () =>
      (await apiClient.get<{ data: Lookup }>("/api/v1/ai/agent-assignment-rules")).data,
  });
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [source, setSource] = useState("");
  const [stageId, setStageId] = useState("");
  const [allowStage, setAllowStage] = useState(false);
  const [priority, setPriority] = useState(100);
  const refresh = () => qc.invalidateQueries({ queryKey: ["ai-agent-assignment-rules"] });
  const create = useMutation({
    mutationFn: () =>
      apiClient.post("/api/v1/ai/agent-assignment-rules", {
        name,
        agent_id: agentId,
        channel_session_id: channelId || null,
        contact_source: source.trim() || null,
        stage_id: stageId || null,
        allow_stage_switch: stageId ? allowStage : false,
        priority,
      }),
    onSuccess: () => {
      toast.success("Regra automática criada.");
      setName("");
      setSource("");
      setChannelId("");
      setStageId("");
      setAllowStage(false);
      void refresh();
    },
    onError: showApiError,
  });
  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      apiClient.patch(`/api/v1/ai/agent-assignment-rules/${id}`, { is_active }),
    onSuccess: refresh,
    onError: showApiError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/ai/agent-assignment-rules/${id}`),
    onSuccess: () => {
      toast.success("Regra excluída.");
      void refresh();
    },
    onError: showApiError,
  });
  const data = query.data;
  const conditionLabel = (rule: Rule) =>
    [
      rule.channel_session_id
        ? `Conexão: ${data?.channels.find((item) => item.id === rule.channel_session_id)?.display_name ?? "selecionada"}`
        : null,
      rule.contact_source ? `Origem: ${rule.contact_source}` : null,
      rule.stage_id
        ? `Etapa: ${data?.stages.find((item) => item.id === rule.stage_id)?.name ?? "selecionada"}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="font-semibold">Regras automáticas de agente</h2>
        <p className="text-sm text-muted-foreground">
          A escolha manual no Inbox sempre prevalece. A regra mais específica vence; em empate, vale
          a maior prioridade.
        </p>
      </div>
      {canWrite ? (
        <div className="grid gap-3 rounded-md border p-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Nome da regra">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tráfego pago comercial"
            />
          </Field>
          <Field label="Agente">
            <select
              className="h-10 w-full rounded-md border bg-background px-3"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            >
              <option value="">Escolha</option>
              {(data?.agents ?? [])
                .filter((item) => item.published_version_id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Conexão (opcional)">
            <select
              className="h-10 w-full rounded-md border bg-background px-3"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
            >
              <option value="">Qualquer conexão</option>
              {(data?.channels ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.display_name || item.phone_number || item.waha_session_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Origem (opcional)">
            <Input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="paid_traffic"
            />
          </Field>
          <Field label="Etapa (opcional)">
            <select
              className="h-10 w-full rounded-md border bg-background px-3"
              value={stageId}
              onChange={(e) => {
                setStageId(e.target.value);
                if (!e.target.value) setAllowStage(false);
              }}
            >
              <option value="">Qualquer etapa</option>
              {(data?.stages ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {embedded(item.crm_pipelines)?.name ?? "Pipeline"} · {item.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Prioridade">
            <Input
              type="number"
              min={0}
              max={1000}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={allowStage} onCheckedChange={setAllowStage} disabled={!stageId} />{" "}
            Permitir troca ao mudar de etapa
          </label>
          <Button
            className="self-end"
            disabled={
              create.isPending ||
              name.trim().length < 2 ||
              !agentId ||
              (!channelId && !source.trim() && !stageId) ||
              Boolean(stageId && !allowStage)
            }
            onClick={() => create.mutate()}
          >
            Criar regra
          </Button>
        </div>
      ) : null}
      <div className="space-y-2">
        {(data?.rules ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma regra criada. Sem regra, vale o agente publicado para a conexão.
          </p>
        ) : (
          (data?.rules ?? []).map((rule) => (
            <div
              key={rule.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <b className="text-sm">{rule.name}</b>
                  <Badge variant={rule.is_active ? "success" : "neutral"}>
                    {rule.is_active ? "Ativa" : "Pausada"}
                  </Badge>
                  {rule.stage_id ? <Badge variant="warning">Troca por etapa</Badge> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {conditionLabel(rule)} · Agente:{" "}
                  {data?.agents.find((item) => item.id === rule.agent_id)?.name ?? "—"} · Prioridade{" "}
                  {rule.priority}
                </p>
              </div>
              {canWrite ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggle.mutate({ id: rule.id, is_active: !rule.is_active })}
                  >
                    {rule.is_active ? "Pausar" : "Ativar"}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      if (confirm(`Excluir a regra “${rule.name}”?`)) remove.mutate(rule.id);
                    }}
                  >
                    Excluir
                  </Button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
