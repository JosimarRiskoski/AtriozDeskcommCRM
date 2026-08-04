"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FAILURE_CATEGORY_LABELS, type FailureCategory } from "@/lib/metrics/failure-presentation";

type FailureItem = {
  id: string;
  occurred_at: string;
  operation: string;
  module: string;
  category: FailureCategory;
  understandable_reason: string;
  recommendation: string;
  attempts: number;
  final_status: string;
  contact: { id: string; name: string; phone: string | null } | null;
  connection: { id: string; name: string; phone: string | null } | null;
  technical: Record<string, unknown>;
};

export function FailuresPanel({
  open,
  days,
  onClose,
}: {
  open: boolean;
  days: number;
  onClose: () => void;
}) {
  const [items, setItems] = useState<FailureItem[]>([]);
  const [category, setCategory] = useState("");
  const [module, setModule] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({
      from: new Date(Date.now() - days * 86400_000).toISOString(),
      to: new Date().toISOString(),
      ...(category ? { category } : {}),
      ...(module ? { module } : {}),
    });
    void fetch(`/api/v1/metrics/failures?${params}`, { signal: controller.signal })
      .then((response) => response.json().then((json) => ({ response, json })))
      .then(({ response, json }) => {
        if (response.ok) setItems(json.data?.items ?? []);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [open, days, category, module]);
  if (!open) return null;
  return (
    <Card id="failure-details" className="border-destructive/40">
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle>Falhas detalhadas</CardTitle>
          <p className="text-xs text-muted-foreground">
            Clique em uma ocorrência para abrir o detalhe técnico, sem esconder o motivo
            compreensível.
          </p>
        </div>
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <label className="grid gap-1 text-xs">
            Categoria
            <select
              className="rounded border bg-background p-2 text-sm"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">Todas</option>
              {Object.entries(FAILURE_CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs">
            Módulo
            <select
              className="rounded border bg-background p-2 text-sm"
              value={module}
              onChange={(event) => setModule(event.target.value)}
            >
              <option value="">Todos</option>
              {["Inbox", "Campanhas", "IA", "Automações", "Integrações"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando falhas…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma falha encontrada neste filtro.</p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <details key={item.id} className="rounded-md border p-3">
                <summary className="grid cursor-pointer list-none gap-2 text-sm md:grid-cols-[150px_1fr_1fr_120px]">
                  <span>{new Date(item.occurred_at).toLocaleString("pt-BR")}</span>
                  <span>
                    <b>{item.contact?.name || "Sem contato"}</b>
                    <small className="block text-muted-foreground">
                      {item.contact?.phone || "—"}
                    </small>
                  </span>
                  <span>
                    {item.operation}
                    <small className="block text-muted-foreground">
                      {item.module} · {FAILURE_CATEGORY_LABELS[item.category]}
                    </small>
                  </span>
                  <span>
                    {item.final_status} · {item.attempts} tentativa(s)
                  </span>
                </summary>
                <div className="mt-3 grid gap-3 border-t pt-3 text-sm md:grid-cols-2">
                  <div>
                    <b>Conexão</b>
                    <p>{item.connection?.name || "Não se aplica"}</p>
                  </div>
                  <div>
                    <b>Motivo</b>
                    <p>{item.understandable_reason}</p>
                  </div>
                  <div className="md:col-span-2">
                    <b>Ação recomendada</b>
                    <p>{item.recommendation}</p>
                  </div>
                  <details className="rounded bg-muted p-2 md:col-span-2">
                    <summary className="cursor-pointer font-medium">Detalhe técnico</summary>
                    <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">
                      {JSON.stringify(item.technical, null, 2)}
                    </pre>
                  </details>
                </div>
              </details>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
