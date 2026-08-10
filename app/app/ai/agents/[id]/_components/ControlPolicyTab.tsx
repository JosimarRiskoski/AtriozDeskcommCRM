"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AgentRow } from "@/hooks/ai/useAgent";
import { useUpdateAgent } from "@/hooks/ai/useAgent";
import { AGENT_CONFIG_DEFAULTS, SAFE_AGENT_FALLBACK } from "@/lib/ai/guardrails-schema";

const asLines = (value: unknown) =>
  Array.isArray(value) ? value.filter((item) => typeof item === "string").join("\n") : "";
const parseLines = (value: string) => [
  ...new Set(
    value
      .split("\n")
      .map((item) => item.trim().replace(/[;,.!?]+$/g, "").trim())
      .filter(Boolean),
  ),
];

function fixedText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as { topic?: unknown; response?: unknown };
      return typeof row.topic === "string" && typeof row.response === "string"
        ? [`${row.topic} = ${row.response}`]
        : [];
    })
    .join("\n");
}

function parseFixed(value: string): Array<{ topic: string; response: string }> {
  return value.split("\n").flatMap((line) => {
    const separator = line.indexOf("=");
    if (separator < 1) return [];
    const topic = line.slice(0, separator).trim();
    const response = line.slice(separator + 1).trim();
    return topic && response ? [{ topic, response }] : [];
  });
}

export function ControlPolicyTab({ agent, readOnly }: { agent: AgentRow; readOnly: boolean }) {
  const cfg = { ...AGENT_CONFIG_DEFAULTS, ...(agent.config ?? {}) };
  const update = useUpdateAgent(agent.id);
  const [knowledge, setKnowledge] = useState(cfg.knowledge_base_enabled !== false);
  const [internet, setInternet] = useState(cfg.external_internet_allowed === true);
  const [forbidden, setForbidden] = useState(asLines(cfg.forbidden_topics));
  const [human, setHuman] = useState(asLines(cfg.human_required_topics));
  const [fixed, setFixed] = useState(fixedText(cfg.fixed_responses));
  const [fallback, setFallback] = useState(String(cfg.fallback_message));
  const [daily, setDaily] = useState((Number(cfg.daily_budget_cents) / 100).toFixed(2));
  const [monthly, setMonthly] = useState((Number(cfg.monthly_budget_cents) / 100).toFixed(2));
  const cents = (value: string) => {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : 0;
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-4 p-4">
        <div>
          <h2 className="font-semibold">Fontes e comportamento seguro</h2>
          <p className="text-sm text-muted-foreground">
            Regras aplicadas em todos os turnos publicados deste agente.
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
          <div>
            <Label htmlFor="policy-kb">Usar a base de conhecimento ativa</Label>
            <p className="text-xs text-muted-foreground">
              Desligado remove a busca na base deste agente.
            </p>
          </div>
          <Switch
            id="policy-kb"
            checked={knowledge}
            onCheckedChange={setKnowledge}
            disabled={readOnly}
          />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
          <div>
            <Label htmlFor="policy-internet">Permitir internet externa</Label>
            <p className="text-xs text-muted-foreground">
              Somente por ferramentas explicitamente habilitadas.
            </p>
          </div>
          <Switch
            id="policy-internet"
            checked={internet}
            onCheckedChange={setInternet}
            disabled={readOnly}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="policy-forbidden">Assuntos proibidos — um por linha</Label>
          <Textarea
            id="policy-forbidden"
            rows={5}
            value={forbidden}
            onChange={(e) => setForbidden(e.target.value)}
            disabled={readOnly}
            placeholder="Ex.: aconselhamento jurídico"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="policy-human">Assuntos que exigem uma pessoa — um por linha</Label>
          <Textarea
            id="policy-human"
            rows={5}
            value={human}
            onChange={(e) => setHuman(e.target.value)}
            disabled={readOnly}
            placeholder={"Documento pessoal\nFatura de energia"}
          />
          <p className="text-xs text-muted-foreground">
            O handoff ocorre antes de gastar IA quando houver correspondência.
          </p>
        </div>
      </Card>
      <Card className="space-y-4 p-4">
        <div>
          <h2 className="font-semibold">Respostas e limites</h2>
          <p className="text-sm text-muted-foreground">
            Zero significa sem limite específico do agente.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="policy-fixed">Respostas fixas</Label>
          <Textarea
            id="policy-fixed"
            rows={6}
            value={fixed}
            onChange={(e) => setFixed(e.target.value)}
            disabled={readOnly}
            placeholder={
              "Preço = Consulte a proposta enviada pelo consultor.\nLGPD = Posso registrar sua solicitação."
            }
          />
          <p className="text-xs text-muted-foreground">
            Formato: assunto = resposta, uma regra por linha.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="policy-fallback">Quando não encontrar informação</Label>
          <Textarea
            id="policy-fallback"
            rows={3}
            value={fallback}
            onChange={(e) => setFallback(e.target.value)}
            disabled={readOnly}
          />
          <p className="text-xs text-muted-foreground">
            Não use frases como “vou encaminhar” aqui. O CRM só promete atendimento humano depois
            de criar um caso real; este texto deve pedir mais detalhes sem desistir da conversa.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="policy-daily">Limite diário (R$)</Label>
            <Input
              id="policy-daily"
              type="number"
              min="0"
              step="0.01"
              value={daily}
              onChange={(e) => setDaily(e.target.value)}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="policy-monthly">Limite mensal (R$)</Label>
            <Input
              id="policy-monthly"
              type="number"
              min="0"
              step="0.01"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              disabled={readOnly}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Ao atingir 100%, novos turnos param, o atendimento humano continua e a central do CRM
          recebe um alerta.
        </p>
        {!readOnly && (
          <Button
            disabled={update.isPending || !fallback.trim()}
            onClick={() =>
              update.mutate({
                config: {
                  knowledge_base_enabled: knowledge,
                  external_internet_allowed: internet,
                  forbidden_topics: parseLines(forbidden),
                  human_required_topics: parseLines(human),
                  fixed_responses: parseFixed(fixed),
                  fallback_message: fallback.trim(),
                  daily_budget_cents: cents(daily),
                  monthly_budget_cents: cents(monthly),
                },
              })
            }
          >
            {update.isPending ? "Salvando…" : "Salvar controles"}
          </Button>
        )}
        {!readOnly && fallback.trim() !== SAFE_AGENT_FALLBACK && /encaminhar|atendente|humano/i.test(fallback) && (
          <Button type="button" variant="outline" onClick={() => setFallback(SAFE_AGENT_FALLBACK)}>
            Usar fallback seguro recomendado
          </Button>
        )}
      </Card>
    </div>
  );
}
