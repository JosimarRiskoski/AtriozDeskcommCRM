"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStartFollowupEnrollment } from "@/hooks/followup/useFollowupEnrollments";
import { useFollowupFlows } from "@/hooks/followup/useFollowupFlows";
import { FlowArrow } from "@/lib/ui/icons";
import { apiClient } from "@/lib/api/client";
import { Badge } from "@/components/ui/badge";
import { useCancelFollowupEnrollment } from "@/hooks/followup/useFollowupQueue";

export function StartFollowupCard({
  contactId,
  compact = false,
}: {
  contactId: string;
  compact?: boolean;
}) {
  const flowsQuery = useFollowupFlows();
  const start = useStartFollowupEnrollment();
  const cancel = useCancelFollowupEnrollment();
  const live = useQuery({
    queryKey: ["contact-followup", contactId],
    queryFn: async () =>
      (
        await apiClient.get<{
          data: null | {
            id: string;
            status: string;
            current_node_id: string;
            next_eval_at: string | null;
            followup_flow_pointers: {
              name: string;
              handoff_policy: string;
              trigger_config: Record<string, unknown>;
            } | null;
            ai_agents: { name: string } | null;
          };
        }>(`/api/v1/contacts/${contactId}/followup`)
      ).data,
  });
  const [flowId, setFlowId] = useState("");
  const activeFlows = (flowsQuery.data ?? []).filter(
    (flow) => flow.status === "active" && flow.active_version_id,
  );
  const selectedFlow = activeFlows.find((flow) => flow.id === flowId) ?? null;
  const current = live.data;

  return (
    <Card className={compact ? "space-y-3 p-3" : "space-y-3 p-4"}>
      <div className="flex items-start gap-3">
        <span className="rounded-md bg-muted p-2">
          <FlowArrow size={18} aria-hidden />
        </span>
        <div>
          <h2 className={compact ? "text-sm font-semibold" : "font-semibold"}>
            Follow-up deste contato
          </h2>
          {!compact && (
            <p className="text-sm text-muted-foreground">
              Inicie manualmente uma sequência já publicada. Uma resposta do contato encerra as
              próximas tentativas.
            </p>
          )}
        </div>
      </div>

      {current ? (
        <div className="bg-muted/30 space-y-2 rounded-md border p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <strong>{current.followup_flow_pointers?.name ?? "Follow-up ativo"}</strong>
            <Badge variant="success">Ativo</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Etapa: {current.current_node_id}
            {current.ai_agents?.name ? ` · Agente: ${current.ai_agents.name}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Próxima ação:{" "}
            {current.next_eval_at
              ? new Date(current.next_eval_at).toLocaleString("pt-BR")
              : "aguardando condição"}
          </p>
          <p className="text-xs text-muted-foreground">Cancelar se responder: ativo</p>
          <Button
            size="sm"
            variant="outline"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate(current.id)}
          >
            Cancelar follow-up
          </Button>
        </div>
      ) : null}

      {current ? null : flowsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando fluxos…</p>
      ) : activeFlows.length === 0 ? (
        <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Nenhum fluxo publicado. Crie e publique um modelo em Follow-ups para poder iniciá-lo aqui.
        </div>
      ) : (
        <div className={compact ? "grid gap-2" : "grid gap-3 md:grid-cols-[1fr_auto] md:items-end"}>
          <div className="space-y-2">
            <Label htmlFor="contact-followup-flow">Fluxo publicado</Label>
            <Select value={flowId} onValueChange={setFlowId}>
              <SelectTrigger id="contact-followup-flow">
                <SelectValue placeholder="Escolha um fluxo" />
              </SelectTrigger>
              <SelectContent>
                {activeFlows.map((flow) => (
                  <SelectItem key={flow.id} value={flow.id}>
                    {flow.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedFlow ? (
              <div className="bg-muted/30 rounded-md border p-2 text-xs text-muted-foreground">
                <p>
                  <b className="text-foreground">Objetivo:</b>{" "}
                  {selectedFlow.objective ?? selectedFlow.name}
                </p>
                <p>
                  {selectedFlow.steps_count ?? 0} mensagem(ns) · duração aproximada{" "}
                  {selectedFlow.duration_minutes ?? 0} min · próximo envio em{" "}
                  {selectedFlow.next_send_minutes ?? 0} min
                </p>
                <p>
                  Agente: {selectedFlow.agent_name ?? "regra automática"} · conexão:{" "}
                  {selectedFlow.channel_name ?? "conexão da conversa"}
                </p>
                <p>
                  Cancelar se responder: {selectedFlow.cancel_on_reply === false ? "não" : "sim"}
                </p>
              </div>
            ) : null}
          </div>
          <Button
            type="button"
            disabled={!flowId || start.isPending}
            onClick={() => start.mutate({ pointerId: flowId, contactId })}
          >
            {start.isPending ? "Iniciando…" : "Iniciar follow-up"}
          </Button>
        </div>
      )}
    </Card>
  );
}
