"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient } from "@/lib/api/client";

type Execution = {
  id: string;
  purpose: string;
  provider: string;
  model: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  http_status: number | null;
  origem_da_escolha: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_cents: number | null;
  latency_ms: number | null;
  created_at: string;
  guidance: string | null;
};

type Payload = { executions: Execution[]; summary: { total: number; errors: number } };

export function AiRunsClient() {
  const [status, setStatus] = useState<"all" | "ok" | "erro">("all");
  const query = useQuery({
    queryKey: ["ai-runs", status],
    queryFn: () =>
      apiClient
        .get<{ data: Payload }>(`/api/v1/ai/runs${status === "all" ? "" : `?status=${status}`}`)
        .then((response) => response.data),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant={status === "all" ? "default" : "outline"} onClick={() => setStatus("all")}>Todas</Button>
        <Button variant={status === "erro" ? "default" : "outline"} onClick={() => setStatus("erro")}>Falhas</Button>
        <Button variant={status === "ok" ? "default" : "outline"} onClick={() => setStatus("ok")}>Concluídas</Button>
      </div>
      {query.isLoading ? <Skeleton className="h-48" /> : query.isError || !query.data ? (
        <Card className="p-6 text-sm text-error-fg">Não foi possível carregar as execuções.</Card>
      ) : query.data.executions.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">Nenhuma execução registrada neste filtro.</Card>
      ) : (
        <div className="space-y-3">
          {query.data.executions.map((run) => (
            <Card key={run.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{run.purpose}</p>
                  <p className="text-xs text-muted-foreground">
                    {run.provider} · {run.model} · {new Date(run.created_at).toLocaleString("pt-BR")}
                  </p>
                </div>
                <Badge variant={run.status === "erro" ? "error" : "success"}>
                  {run.status === "erro" ? "Falhou" : "Concluída"}
                </Badge>
              </div>
              {run.status === "erro" ? (
                <div className="rounded-md border border-error-fg/30 bg-error/10 p-3 text-sm">
                  <p className="font-medium">{run.error_code ?? "Erro não classificado"}{run.http_status ? ` · HTTP ${run.http_status}` : ""}</p>
                  {run.error_message ? <p className="mt-1 break-words text-muted-foreground">{run.error_message}</p> : null}
                  {run.guidance ? <p className="mt-2">O que fazer: {run.guidance}</p> : null}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {run.input_tokens + run.output_tokens} tokens · {run.latency_ms ?? 0} ms
                </p>
              )}
              <p className="text-xs text-muted-foreground">Escolha do modelo: {run.origem_da_escolha ?? "não registrada"}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
