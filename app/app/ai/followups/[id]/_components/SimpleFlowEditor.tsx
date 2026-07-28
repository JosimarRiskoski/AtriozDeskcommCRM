"use client";

import { useMemo, useState } from "react";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFollowupFlow, type FollowupFlowDetailRow } from "@/hooks/followup/useFollowupFlow";
import type { FlowGraph, FlowNode } from "@/lib/followup/graph-schema";
import { graphsEqual } from "@/lib/followup/graph-mappers";
import { PublishBar } from "./PublishBar";

interface Props {
  flowId: string;
  initialData: FollowupFlowDetailRow;
}

type WaitNode = Extract<FlowNode, { type: "wait" }>;
type ActionNode = Extract<FlowNode, { type: "action" }>;

function orderedNodes(graph: FlowGraph): FlowNode[] {
  const trigger = graph.nodes.find((node) => node.type === "trigger");
  if (!trigger) return [];
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const result: FlowNode[] = [trigger];
  const visited = new Set([trigger.id]);
  let current: FlowNode = trigger;
  while (result.length <= graph.nodes.length) {
    const outbound = graph.edges.filter((edge) => edge.source === current.id);
    if (outbound.length !== 1) return [];
    const next = byId.get(outbound[0]!.target);
    if (!next || visited.has(next.id)) return [];
    result.push(next);
    visited.add(next.id);
    current = next;
    if (next.type === "end") break;
  }
  return visited.size === graph.nodes.length && result.at(-1)?.type === "end" ? result : [];
}

export function isSimpleFollowupGraph(graph: FlowGraph | null): boolean {
  if (!graph) return false;
  const ordered = orderedNodes(graph);
  return (
    ordered.length >= 2 &&
    ordered.every((node) => ["trigger", "wait", "action", "end"].includes(node.type)) &&
    ordered
      .filter((node) => node.type === "action")
      .every((node) => (node as ActionNode).config.mode === "ai_message")
  );
}

function minutesLabel(minutes: number): string {
  if (minutes % 1_440 === 0) {
    const days = minutes / 1_440;
    return `${days} ${days === 1 ? "dia" : "dias"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hora" : "horas"}`;
  }
  return `${minutes} minutos`;
}

export function SimpleFlowEditor({ flowId, initialData }: Props) {
  const { data: flow = initialData } = useFollowupFlow(flowId, { initialData });
  const initialGraph = initialData.draft_graph!;
  const [graph, setGraph] = useState<FlowGraph>(initialGraph);
  const [savedGraph, setSavedGraph] = useState(initialGraph);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const ordered = useMemo(() => orderedNodes(graph), [graph]);
  const steps = ordered.filter(
    (node): node is WaitNode | ActionNode => node.type === "wait" || node.type === "action",
  );

  const updateNode = (nodeId: string, update: (node: FlowNode) => FlowNode) => {
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === nodeId ? update(node) : node)),
    }));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PublishBar
        flowId={flowId}
        flow={flow}
        graph={graph}
        dirty={!graphsEqual(graph, savedGraph)}
        onSaved={setSavedGraph}
        onPublishErrors={setErrors}
        onPublishSuccess={() => setErrors({})}
      />

      <div className="mx-auto w-full max-w-4xl space-y-4 overflow-y-auto p-6">
        <div>
          <h2 className="text-lg font-semibold">Sequência de mensagens</h2>
          <p className="text-sm text-muted-foreground">
            Ajuste somente o tempo e o que a IA deve comunicar. Se o contato responder, o fluxo será
            encerrado automaticamente.
          </p>
        </div>

        {steps.map((node, index) => {
          const stepNumber = Math.floor(index / 2) + 1;
          if (node.type === "wait") {
            const minutes = Math.round(
              (node.config.mode === "fixed" ? node.config.duration_ms : node.config.max_ms) /
                60_000,
            );
            return (
              <Card key={node.id} className="grid gap-3 p-4 md:grid-cols-[1fr_220px] md:items-end">
                <div>
                  <p className="text-sm font-medium">Antes da mensagem {stepNumber}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Atualmente: aguardar {minutesLabel(minutes)}.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`wait-${node.id}`}>Aguardar (minutos)</Label>
                  <Input
                    id={`wait-${node.id}`}
                    type="number"
                    min={5}
                    max={129_600}
                    value={minutes}
                    onChange={(event) => {
                      const value = Math.max(5, Number(event.target.value) || 5);
                      updateNode(node.id, (current) => ({
                        ...(current as WaitNode),
                        config: { mode: "fixed", duration_ms: value * 60_000 },
                      }));
                    }}
                  />
                </div>
              </Card>
            );
          }

          const message = node.config.mode === "ai_message" ? node.config.prompt_hint : "";
          return (
            <Card key={node.id} className="space-y-3 p-4">
              <div>
                <p className="text-sm font-medium">Mensagem {stepNumber}</p>
                <p className="text-xs text-muted-foreground">
                  Escreva a orientação em linguagem comum. A IA adapta ao contexto sem inventar
                  dados.
                </p>
              </div>
              <Textarea
                aria-label={`Orientação da mensagem ${stepNumber}`}
                value={message}
                maxLength={1000}
                rows={4}
                onChange={(event) =>
                  updateNode(node.id, (current) => ({
                    ...(current as ActionNode),
                    config: { mode: "ai_message", prompt_hint: event.target.value },
                  }))
                }
              />
              {errors[node.id]?.map((error) => (
                <p key={error} className="text-xs text-error-fg">
                  {error}
                </p>
              ))}
            </Card>
          );
        })}

        <Card className="border-dashed p-4 text-sm text-muted-foreground">
          Para criar decisões, ramificações ou classificações por IA, use “Personalizar fluxo”. O
          modo avançado continua disponível sem alterar esta sequência.
        </Card>
      </div>
    </div>
  );
}
