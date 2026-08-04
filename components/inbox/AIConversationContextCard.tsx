"use client";

import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { apiClient } from "@/lib/api/client";

type Context = {
  summary: string | null;
  commitments: string[];
  objections: string[];
  next_action: string | null;
  notes: Array<{ id: string; headline: string; body: string; created_at: string }>;
  sources: Array<{ id: string; name: string; source_type: string; status: string }>;
  agent: { id: string; name: string } | null;
  agent_selection_mode: "inherit" | "manual";
  agent_selection_reason: string | null;
  knowledge_enabled: boolean;
  last_updated_at: string | null;
};

export function AIConversationContextCard({ conversationId }: { conversationId: string }) {
  const query = useQuery({
    queryKey: ["conversation-ai-context", conversationId],
    queryFn: async () =>
      (await apiClient.get<{ data: Context }>(`/api/v1/conversations/${conversationId}/ai-context`))
        .data,
  });
  const data = query.data;
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        O que a IA sabe nesta conversa
      </h3>
      <Card className="mt-2 space-y-3 p-3 text-xs">
        {query.isLoading ? <p className="text-muted-foreground">Carregando contexto…</p> : null}
        {query.isError ? (
          <p className="text-error-fg">Não foi possível consultar o contexto da IA.</p>
        ) : null}
        {data ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={data.agent ? "info" : "neutral"}>
                {data.agent?.name ?? "Sem agente publicado"}
              </Badge>
              <Badge variant="outline">
                {data.agent_selection_mode === "manual" ? "Escolha manual" : "Regra automática"}
              </Badge>
              <Badge variant={data.knowledge_enabled ? "success" : "neutral"}>
                Base {data.knowledge_enabled ? "permitida" : "desativada"}
              </Badge>
            </div>
            <p className="text-muted-foreground">
              Motivo da seleção: {data.agent_selection_reason || "regra geral da organização"}
            </p>
            <div>
              <b>Resumo anterior</b>
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                {data.summary || "Ainda não existe resumo acumulado."}
              </p>
            </div>
            {data.next_action ? (
              <div>
                <b>Próxima ação lembrada</b>
                <p className="text-muted-foreground">{data.next_action}</p>
              </div>
            ) : null}
            <div>
              <b>Notas autorizadas para a IA ({data.notes.length})</b>
              {data.notes.length ? (
                <ul className="mt-1 space-y-1">
                  {data.notes.map((note) => (
                    <li key={note.id} title={note.body}>
                      • {note.headline}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted-foreground">Nenhuma nota durável.</p>
              )}
            </div>
            <div>
              <b>Fontes ativas ({data.sources.length})</b>
              {data.sources.length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {data.sources.map((source) => (
                    <Badge key={source.id} variant="outline">
                      {source.name}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-muted-foreground">Nenhuma fonte ativa para este agente.</p>
              )}
            </div>
            <p className="border-t pt-2 text-[11px] text-muted-foreground">
              Última atualização:{" "}
              {data.last_updated_at
                ? new Date(data.last_updated_at).toLocaleString("pt-BR")
                : "não informada"}
              . Observações internas humanas não são enviadas automaticamente à IA.
            </p>
          </>
        ) : null}
      </Card>
    </section>
  );
}
