"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ModeMetrics = {
  conversations: number;
  avg_first_response_seconds: number | null;
  avg_resolution_seconds: number | null;
  resolved: number;
  converted: number;
  handoffs: number;
  reopened: number;
  cost_cents: number | null;
  quality_score: number | null;
};
type Comparison = {
  origins: string[];
  human: ModeMetrics;
  ai: ModeMetrics;
  settings: { human_hourly_cost_cents: number | null; currency: string };
  quality_formula: string;
};
const duration = (seconds: number | null) =>
  seconds === null
    ? "Sem dados"
    : seconds < 60
      ? `${Math.round(seconds)}s`
      : `${Math.round(seconds / 60)}min`;
const money = (cents: number | null) =>
  cents === null
    ? "Não configurado"
    : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function HumanAiComparison({
  days,
  canConfigureCost,
}: {
  days: number;
  canConfigureCost: boolean;
}) {
  const [data, setData] = useState<Comparison | null>(null);
  const [origin, setOrigin] = useState("");
  const [hourlyCost, setHourlyCost] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      from: new Date(Date.now() - days * 86400_000).toISOString(),
      to: new Date().toISOString(),
      ...(origin ? { origin } : {}),
    });
    void fetch(`/api/v1/metrics/human-ai?${params}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((json) => {
        if (json.data) {
          setData(json.data);
          setHourlyCost(
            json.data.settings.human_hourly_cost_cents == null
              ? ""
              : String(json.data.settings.human_hourly_cost_cents / 100),
          );
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [days, origin]);
  if (!data)
    return (
      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground">
          Calculando comparativo humano × IA…
        </CardContent>
      </Card>
    );
  const saveCost = async () => {
    const value =
      hourlyCost.trim() === "" ? null : Math.round(Number(hourlyCost.replace(",", ".")) * 100);
    if (value !== null && (!Number.isFinite(value) || value < 0))
      return toast.error("Informe um custo válido.");
    const response = await fetch("/api/v1/metrics/human-ai", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ human_hourly_cost_cents: value }),
    });
    const json = await response.json();
    if (!response.ok) return toast.error(json?.error?.message ?? "Não foi possível salvar.");
    toast.success("Custo humano atualizado.");
  };
  const rows: Array<[string, (mode: ModeMetrics) => string | number]> = [
    ["Conversas", (mode) => mode.conversations],
    ["Primeira resposta", (mode) => duration(mode.avg_first_response_seconds)],
    ["Resolução", (mode) => duration(mode.avg_resolution_seconds)],
    ["Resolvidas", (mode) => mode.resolved],
    ["Conversões", (mode) => mode.converted],
    ["Handoffs", (mode) => mode.handoffs],
    ["Reaberturas", (mode) => mode.reopened],
    ["Custo estimado", (mode) => money(mode.cost_cents)],
    [
      "Índice de qualidade",
      (mode) => (mode.quality_score === null ? "Sem dados" : `${mode.quality_score}/100`),
    ],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Atendimento humano × IA</CardTitle>
        <p className="text-xs text-muted-foreground">
          Compare tempo, resultado, custo, handoff, reabertura e qualidade no mesmo período.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="grid max-w-xs gap-1 text-xs">
          Origem
          <select
            className="rounded border bg-background p-2 text-sm"
            value={origin}
            onChange={(event) => setOrigin(event.target.value)}
          >
            <option value="">Todas as origens</option>
            {data.origins.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-2 text-left">Indicador</th>
                <th className="p-2 text-right">Humano</th>
                <th className="p-2 text-right">IA</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, read]) => (
                <tr key={label} className="border-b">
                  <td className="p-2">{label}</td>
                  <td className="p-2 text-right font-medium">{read(data.human)}</td>
                  <td className="p-2 text-right font-medium">{read(data.ai)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">Qualidade: {data.quality_formula}</p>
        {canConfigureCost && (
          <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
            <label className="grid gap-1 text-xs">
              Custo humano por hora (R$)
              <input
                className="rounded border bg-background p-2 text-sm"
                value={hourlyCost}
                onChange={(event) => setHourlyCost(event.target.value)}
                placeholder="Ex.: 35,00"
              />
            </label>
            <Button variant="secondary" onClick={() => void saveCost()}>
              Salvar custo
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
