"use client";

import { useQuery } from "@tanstack/react-query";

import type { WhatsAppDiagnosticsPayload } from "@/app/api/v1/system-health/whatsapp-diagnostics/route";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient } from "@/lib/api/client";

function when(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("pt-BR") : "Ainda não registrado";
}

function webhookLabel(status: string | null | undefined) {
  if (status === "processed") return { label: "Processado", variant: "success" as const };
  if (status === "error") return { label: "Falhou", variant: "error" as const };
  return { label: status === "received" ? "Recebido" : "Sem evento", variant: "warning" as const };
}

export function WhatsAppDiagnosticsClient() {
  const query = useQuery({
    queryKey: ["whatsapp-diagnostics"],
    queryFn: () =>
      apiClient
        .get<{ data: WhatsAppDiagnosticsPayload }>("/api/v1/system-health/whatsapp-diagnostics")
        .then((response) => response.data),
    refetchInterval: 10_000,
  });

  if (query.isLoading)
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  if (query.isError || !query.data)
    return (
      <Card className="p-8 text-center text-sm text-error-fg">
        Não foi possível carregar o diagnóstico agora.
      </Card>
    );

  const data = query.data;
  const webhook = webhookLabel(data.latest_webhook?.status);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>Atualizado em {when(data.checked_at)}</span>
        <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
          Atualizar agora
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Card className="space-y-2 p-4">
          <h2 className="text-sm font-semibold">1. Conexões</h2>
          {data.sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma conexão ativa.</p>
          ) : (
            data.sessions.map((session) => (
              <div key={session.id} className="rounded-md border border-border p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{session.label}</span>
                  <Badge variant={session.status === "WORKING" ? "success" : "warning"}>
                    {session.status ?? "Sem estado"}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Checagem: {when(session.last_health_check_at)}
                </p>
                {session.status_reason ? (
                  <p className="mt-1 text-xs text-warning-fg">{session.status_reason}</p>
                ) : null}
              </div>
            ))
          )}
        </Card>
        <Card className="space-y-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">2. Webhook da Evolution</h2>
            <Badge variant={webhook.variant}>{webhook.label}</Badge>
          </div>
          <p className="text-sm">Último evento: {data.latest_webhook?.event_type ?? "nenhum"}</p>
          <p className="text-xs text-muted-foreground">
            Recebido: {when(data.latest_webhook?.received_at)}
          </p>
          {data.latest_webhook?.error_message ? (
            <p className="text-xs text-error-fg">{data.latest_webhook.error_message}</p>
          ) : null}
        </Card>
        <Card className="space-y-2 p-4">
          <h2 className="text-sm font-semibold">3. Persistência no Inbox</h2>
          <p className="text-sm">
            Última mensagem recebida: {when(data.latest_inbound?.received_at)}
          </p>
          <p className="text-xs text-muted-foreground">
            Pendências de identidade: {data.pending_identity.total}
          </p>
          {data.pending_identity.failed > 0 ? (
            <p className="text-xs text-error-fg">
              {data.pending_identity.failed} pendência(s) exigem atenção.
            </p>
          ) : (
            <p className="text-xs text-success-fg">Nenhuma pendência com falha.</p>
          )}
          {data.pending_identity.oldest_at ? (
            <p className="text-xs text-muted-foreground">
              Mais antiga: {when(data.pending_identity.oldest_at)}
            </p>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
