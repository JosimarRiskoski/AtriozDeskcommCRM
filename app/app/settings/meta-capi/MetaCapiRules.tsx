"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Stage = { id: string; name: string; is_won: boolean; is_lost: boolean };
type Pipeline = { id: string; name: string; stages: Stage[] };
type Rule = {
  pipeline_id: string;
  stage_id: string;
  event_name: "Lead" | "QualifiedLead" | "Purchase";
  enabled: boolean;
};

const labels: Record<Rule["event_name"], string> = {
  Lead: "Lead — novo lead",
  QualifiedLead: "QualifiedLead — proposta enviada",
  Purchase: "Purchase — venda fechada",
};

export function MetaCapiRules() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/v1/settings/meta-capi/rules")
      .then((response) => response.json())
      .then((json) => {
        const loadedPipelines = (json.data?.pipelines ?? []) as Pipeline[];
        const loadedRules = (json.data?.rules ?? []).filter((rule: Rule) => rule.enabled);
        setPipelines(loadedPipelines);
        if (loadedRules.length) {
          setRules(loadedRules);
          return;
        }

        // Apenas sugere a configuração já escolhida pelo usuário no CRM; nada é
        // gravado nem ativado sem o botão Salvar marcos.
        const obraFisco = loadedPipelines.find(
          (pipeline) => pipeline.name.trim().toLocaleLowerCase("pt-BR") === "obrafisco",
        );
        if (!obraFisco) return;
        const stageByName = new Map(
          obraFisco.stages.map((stage) => [stage.name.trim().toLocaleLowerCase("pt-BR"), stage]),
        );
        const suggested = [
          ["Lead", "novo lead"],
          ["QualifiedLead", "proposta enviada"],
          ["Purchase", "fechado"],
        ] as const;
        setRules(
          suggested.flatMap(([event_name, stageName]) => {
            const stage = stageByName.get(stageName);
            return stage
              ? [{ pipeline_id: obraFisco.id, stage_id: stage.id, event_name, enabled: false }]
              : [];
          }),
        );
      })
      .catch(() => toast.error("Não foi possível carregar os marcos automáticos."))
      .finally(() => setLoading(false));
  }, []);

  const pipelineById = useMemo(() => new Map(pipelines.map((pipeline) => [pipeline.id, pipeline])), [pipelines]);

  function addRule() {
    const pipeline = pipelines[0];
    const stage = pipeline?.stages[0];
    if (!pipeline || !stage) return;
    setRules((current) => [...current, { pipeline_id: pipeline.id, stage_id: stage.id, event_name: "Lead", enabled: false }]);
  }

  function updateRule(index: number, next: Partial<Rule>) {
    setRules((current) =>
      current.map((rule, ruleIndex) => {
        if (ruleIndex !== index) return rule;
        const updated = { ...rule, ...next };
        if (next.pipeline_id) updated.stage_id = pipelineById.get(next.pipeline_id)?.stages[0]?.id ?? "";
        return updated;
      }),
    );
  }

  async function save() {
    if (rules.some((rule) => !rule.pipeline_id || !rule.stage_id)) {
      toast.error("Selecione o funil e a etapa em todos os marcos.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/v1/settings/meta-capi/rules", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rules }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "Falha ao salvar os marcos.");
      setRules((json.data.rules ?? []).filter((rule: Rule) => rule.enabled));
      toast.success("Marcos automáticos salvos.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar os marcos.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="font-semibold">Marcos automáticos por etapa</h2>
        <p className="text-sm text-muted-foreground">
          Uma regra só entra na fila quando esta página estiver configurada, a conexão Meta estiver ativa e a regra estiver ligada. Nenhum evento é enviado dentro do Kanban.
        </p>
      </div>
      {loading ? <p className="text-sm text-muted-foreground">Carregando funis...</p> : null}
      {!loading && !pipelines.length ? <p className="text-sm text-muted-foreground">Crie um funil e pelo menos uma etapa antes de configurar conversões.</p> : null}
      <div className="space-y-3">
        {rules.map((rule, index) => {
          const stages = pipelineById.get(rule.pipeline_id)?.stages ?? [];
          const stage = stages.find((item) => item.id === rule.stage_id);
          const purchaseNeedsWon = rule.event_name === "Purchase" && !stage?.is_won;
          return (
            <div key={`${rule.pipeline_id}:${rule.stage_id}:${rule.event_name}:${index}`} className="grid gap-3 rounded-md border p-4 md:grid-cols-[1.2fr_1.2fr_1fr_auto_auto] md:items-end">
              <div className="space-y-2">
                <Label>Evento</Label>
                <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={rule.event_name} onChange={(event) => updateRule(index, { event_name: event.target.value as Rule["event_name"] })}>
                  {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Funil</Label>
                <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={rule.pipeline_id} onChange={(event) => updateRule(index, { pipeline_id: event.target.value })}>
                  {pipelines.map((pipeline) => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Etapa</Label>
                <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={rule.stage_id} onChange={(event) => updateRule(index, { stage_id: event.target.value })}>
                  {stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Switch checked={rule.enabled} onCheckedChange={(enabled) => updateRule(index, { enabled })} />
                <span className="text-sm">Ativo</span>
              </div>
              <Button type="button" variant="ghost" onClick={() => setRules((current) => current.filter((_, ruleIndex) => ruleIndex !== index))}>Remover</Button>
              {purchaseNeedsWon ? <p className="text-xs text-destructive md:col-span-5">Purchase exige uma etapa marcada como “ganho” nas configurações do funil.</p> : null}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={loading || !pipelines.length} onClick={addRule}>Adicionar marco</Button>
        <Button type="button" disabled={saving || loading} onClick={() => void save()}>{saving ? "Salvando..." : "Salvar marcos"}</Button>
      </div>
    </Card>
  );
}
