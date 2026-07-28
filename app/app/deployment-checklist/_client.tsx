"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { DeploymentChecklistPayload } from "@/app/api/v1/deployment-checklist/route";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient } from "@/lib/api/client";

export function DeploymentChecklistClient() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["deployment-checklist"],
    queryFn: () => apiClient.get<{ data: DeploymentChecklistPayload }>("/api/v1/deployment-checklist").then((r) => r.data),
  });
  const update = useMutation({
    mutationFn: (input: { id: string; completed: boolean }) =>
      apiClient.patch<{ data: DeploymentChecklistPayload }>("/api/v1/deployment-checklist", input),
    onSuccess: (response) => qc.setQueryData(["deployment-checklist"], response.data),
  });

  if (query.isLoading) return <div className="space-y-2">{Array.from({ length: 7 }).map((_, index) => <Skeleton key={index} className="h-20" />)}</div>;
  if (!query.data || query.isError) return <Card className="p-8 text-center text-sm text-error-fg">Não foi possível carregar o checklist.</Card>;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-semibold">Progresso da implantação</p>
          <p className="text-xs text-muted-foreground">{query.data.completed} de {query.data.total} itens concluídos</p>
        </div>
        <Badge variant={query.data.ready ? "success" : "warning"}>
          {query.data.ready ? "Pronto para homologação final" : "Ainda não liberar ao cliente"}
        </Badge>
      </Card>
      <div className="space-y-2">
        {query.data.items.map((item) => (
          <Card key={item.id} className="flex flex-wrap items-center gap-3 p-4">
            <input
              type="checkbox"
              checked={item.completed}
              disabled={item.automatic || update.isPending}
              onChange={(event) => update.mutate({ id: item.id, completed: event.currentTarget.checked })}
              aria-label={`${item.completed ? "Desmarcar" : "Marcar"} ${item.title}`}
              className="size-4 shrink-0 accent-primary disabled:cursor-not-allowed disabled:opacity-60"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">{item.title}</p>
                <Badge variant="neutral">{item.automatic ? "Verificação automática" : "Confirmação manual"}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
            </div>
            {item.action_url && item.action_label ? <Button asChild variant="outline" size="sm"><Link href={item.action_url}>{item.action_label}</Link></Button> : null}
          </Card>
        ))}
      </div>
    </div>
  );
}
