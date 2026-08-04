"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { apiClient } from "@/lib/api/client";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { contactSourceLabel } from "@/lib/contacts/source-labels";

interface SourceEvent {
  id: string;
  source: string;
  campaign_id: string | null;
  integration: string | null;
  channel_session_id: string | null;
  external_id: string | null;
  tracking: Record<string, unknown>;
  metadata: Record<string, unknown>;
  occurred_at: string;
}

export function ContactOriginsCard({ contactId }: { contactId: string }) {
  const query = useQuery({
    queryKey: ["contact-origins", contactId],
    queryFn: async () =>
      (await apiClient.get<{ data: SourceEvent[] }>(`/api/v1/contacts/${contactId}/origins`)).data,
  });
  const events = query.data ?? [];
  const first = events[0];
  const last = events.at(-1);

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="font-semibold">Histórico de origens</h2>
        <p className="text-xs text-muted-foreground">
          Cada entrada fica preservada; uma nova origem não apaga as anteriores.
        </p>
      </div>
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando origens…</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma origem registrada.</p>
      ) : (
        <>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase text-muted-foreground">Primeira origem</dt>
              <dd className="mt-1">{contactSourceLabel(first!.source)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted-foreground">
                Última interação de origem
              </dt>
              <dd className="mt-1">{contactSourceLabel(last!.source)}</dd>
            </div>
          </dl>
          <ol className="space-y-2">
            {[...events].reverse().map((event) => (
              <li key={event.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="neutral">{contactSourceLabel(event.source)}</Badge>
                  <time className="text-xs text-muted-foreground">
                    {format(new Date(event.occurred_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                  </time>
                </div>
                {(event.integration || event.campaign_id || event.external_id) && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {[
                      event.integration && `Integração: ${event.integration}`,
                      event.campaign_id && `Campanha: ${event.campaign_id}`,
                      event.external_id && `ID externo: ${event.external_id}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  );
}
