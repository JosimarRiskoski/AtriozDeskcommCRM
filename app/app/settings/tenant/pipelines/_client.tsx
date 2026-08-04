"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { updatePipelineConfig } from "@/app/actions/settings/updatePipelineConfig";
import {
  archivePipeline,
  archivePipelineStage,
  createPipeline,
  duplicatePipeline,
  movePipeline,
  movePipelineStage,
  savePipelineStage,
  setDefaultPipeline,
  updatePipelineIdentity,
} from "@/app/actions/settings/managePipelines";
import type { PipelineConfigPatch } from "@/lib/schemas/settings";
import { ArrowCounterClockwise, ArrowClockwise, Copy, Plus, Trash } from "@/lib/ui/icons";

type StageHint = "new" | "qualifying" | "qualified" | "proposal" | "negotiation" | "won" | "lost";
export interface StageRow {
  id: string;
  pipeline_id: string;
  name: string;
  color: string | null;
  position: number;
  is_won: boolean;
  is_lost: boolean;
  requires_human: boolean;
  expected_duration_hours: number | null;
  agent_stage_hint?: StageHint | null;
}
export interface PipelineRow {
  id: string;
  name: string;
  slug: string;
  vocabulary: Record<string, string> | null;
  settings: Record<string, unknown> | null;
  stages: StageRow[];
  is_default: boolean;
  position: number;
}
interface CustomFieldDef {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  visibility?: "human_only" | "ai_allowed" | "commercial";
  options?: Array<{ value: string; label: string }>;
}

const FIELD_TYPES = [
  ["text", "Texto curto"],
  ["textarea", "Texto longo"],
  ["number", "Número"],
  ["date", "Data"],
  ["select", "Lista de escolha"],
  ["multiselect", "Múltiplas escolhas"],
  ["boolean", "Sim ou não"],
  ["email", "E-mail"],
  ["phone", "Telefone"],
  ["url", "Link"],
] as const;
const HINTS = [
  ["", "Sem equivalente para a IA"],
  ["new", "Novo"],
  ["qualifying", "Em qualificação"],
  ["qualified", "Qualificado"],
  ["proposal", "Proposta"],
  ["negotiation", "Negociação"],
  ["won", "Ganho"],
  ["lost", "Perdido"],
] as const;

function readFields(settings: Record<string, unknown> | null): CustomFieldDef[] {
  const fields = settings?.fields;
  return Array.isArray(fields) ? (fields as CustomFieldDef[]) : [];
}
function readLostReasons(settings: Record<string, unknown> | null): string[] {
  const reasons = settings?.lost_reasons;
  return Array.isArray(reasons) ? reasons.filter((r): r is string => typeof r === "string") : [];
}
function keyFromLabel(label: string) {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

export function PipelinesClient({ pipelines }: { pipelines: PipelineRow[] }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<
    "reuniao" | "vendas" | "imobiliaria" | "energia" | "servicos" | "suporte"
  >("reuniao");
  const [isDefault, setIsDefault] = useState(false);
  const [pending, startTransition] = useTransition();
  function submit() {
    const currentDefault = pipelines.find((pipeline) => pipeline.is_default);
    if (
      isDefault &&
      currentDefault &&
      !window.confirm(
        `“${currentDefault.name}” deixará de ser o funil principal. Deseja continuar?`,
      )
    )
      return;
    startTransition(async () => {
      const result = await createPipeline({ name, preset, isDefault });
      if (result.ok) {
        toast.success("Funil criado com etapas prontas.");
        setName("");
        setIsDefault(false);
        setCreating(false);
        window.location.reload();
      } else toast.error(result.error);
    });
  }
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating((v) => !v)}>
          <Plus size={16} /> Novo funil
        </Button>
      </div>
      {creating ? (
        <Card className="grid gap-4 p-5 md:grid-cols-[1fr_260px_180px_auto] md:items-end">
          <div className="space-y-1">
            <Label>Nome do novo funil</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Comercial BeHub"
            />
          </div>
          <div className="space-y-1">
            <Label>Começar com modelo</Label>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={preset}
              onChange={(e) => setPreset(e.target.value as typeof preset)}
            >
              <option value="reuniao">Comercial da reunião</option>
              <option value="vendas">Vendas</option>
              <option value="imobiliaria">Imobiliária</option>
              <option value="energia">Energia compartilhada</option>
              <option value="servicos">Serviços</option>
              <option value="suporte">Suporte</option>
            </select>
          </div>
          <label className="flex h-10 items-center gap-2 text-sm">
            <Switch checked={isDefault} onCheckedChange={setIsDefault} /> Funil principal
          </label>
          <Button onClick={submit} disabled={pending || name.trim().length < 2}>
            {pending ? "Criando…" : "Criar funil"}
          </Button>
        </Card>
      ) : null}
      {pipelines.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nenhum funil ativo. Clique em <strong>Novo funil</strong> e escolha um modelo.
        </Card>
      ) : null}
      {pipelines.map((pipeline, index) => (
        <PipelineEditor
          key={pipeline.id}
          pipeline={pipeline}
          index={index}
          total={pipelines.length}
        />
      ))}
    </div>
  );
}

function PipelineEditor({
  pipeline,
  index,
  total,
}: {
  pipeline: PipelineRow;
  index: number;
  total: number;
}) {
  const vocabulary = pipeline.vocabulary ?? {};
  const [pipelineName, setPipelineName] = useState(pipeline.name);
  const [lead, setLead] = useState(vocabulary.lead ?? "Lead");
  const [deal, setDeal] = useState(vocabulary.deal ?? "Negócio");
  const [won, setWon] = useState(vocabulary.won ?? "Ganho");
  const [lost, setLost] = useState(vocabulary.lost ?? "Perdido");
  const [reasons, setReasons] = useState(readLostReasons(pipeline.settings));
  const [reasonDraft, setReasonDraft] = useState("");
  const [fields, setFields] = useState(readFields(pipeline.settings));
  const [valueLabel, setValueLabel] = useState(
    typeof pipeline.settings?.value_label === "string"
      ? pipeline.settings.value_label
      : "Valor previsto",
  );
  const [isPending, startTransition] = useTransition();

  function saveConfiguration() {
    const patch: PipelineConfigPatch = {
      vocabulary: { lead, deal, won, lost },
      fields: fields as PipelineConfigPatch["fields"],
      lost_reasons: reasons,
      value_label: valueLabel,
    };
    startTransition(async () => {
      const [identity, config] = await Promise.all([
        updatePipelineIdentity(pipeline.id, pipelineName),
        updatePipelineConfig(pipeline.id, patch),
      ]);
      if (identity.ok && config.ok) toast.success("Funil atualizado.");
      else
        toast.error(!identity.ok ? identity.error : !config.ok ? config.error : "Falha ao salvar.");
    });
  }
  function addField() {
    setFields((items) => [
      ...items,
      {
        key: `campo_${items.length + 1}`,
        label: "Novo campo",
        type: "text",
        required: false,
        visibility: "commercial",
      },
    ]);
  }
  function updateField(index: number, patch: Partial<CustomFieldDef>) {
    setFields((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }
  function execute(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(success);
        window.location.reload();
      } else toast.error(result.error ?? "Falha na operação.");
    });
  }

  return (
    <Card className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[260px] flex-1">
          <Label>Nome do funil</Label>
          <Input
            className="mt-1 max-w-xl"
            value={pipelineName}
            onChange={(e) => setPipelineName(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">Endereço interno: /{pipeline.slug}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={pipeline.is_default ? "secondary" : "outline"}
            onClick={() =>
              window.confirm(
                `Este funil passará a abrir primeiro no Kanban e substituirá o principal atual. Deseja continuar?`,
              ) && execute(() => setDefaultPipeline(pipeline.id), "Funil principal atualizado.")
            }
            disabled={isPending || pipeline.is_default}
          >
            {pipeline.is_default ? "Principal" : "Definir como principal"}
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={() => execute(() => movePipeline(pipeline.id, -1), "Funil movido.")}
            disabled={isPending || index === 0}
            aria-label="Mover funil para cima"
          >
            <ArrowCounterClockwise size={15} />
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={() => execute(() => movePipeline(pipeline.id, 1), "Funil movido.")}
            disabled={isPending || index === total - 1}
            aria-label="Mover funil para baixo"
          >
            <ArrowClockwise size={15} />
          </Button>
          <Button
            variant="outline"
            onClick={() => execute(() => duplicatePipeline(pipeline.id), "Funil duplicado.")}
            disabled={isPending}
          >
            <Copy size={15} /> Duplicar
          </Button>
          <Button
            variant="outline"
            onClick={() => execute(() => archivePipeline(pipeline.id), "Funil arquivado.")}
            disabled={isPending || pipeline.is_default}
            title={
              pipeline.is_default
                ? "Defina outro funil como padrão antes de arquivar este."
                : undefined
            }
          >
            <Trash size={15} /> Arquivar
          </Button>
        </div>
      </header>

      <section className="space-y-3">
        <div>
          <h3 className="font-medium">Rótulo do valor</h3>
          <p className="text-xs text-muted-foreground">
            Personalize para o nicho, por exemplo “Valor previsto da fatura” ou “Valor do contrato”.
          </p>
        </div>
        <Input
          className="max-w-xl"
          value={valueLabel}
          onChange={(event) => setValueLabel(event.target.value)}
          placeholder="Valor previsto"
        />
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="font-medium">Como sua empresa chama cada item?</h3>
          <p className="text-xs text-muted-foreground">
            Esses nomes aparecem nas telas; não alteram a segurança nem os dados.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Vocabulary label="Cliente em potencial" value={lead} onChange={setLead} />
          <Vocabulary label="Oportunidade" value={deal} onChange={setDeal} />
          <Vocabulary label="Resultado positivo" value={won} onChange={setWon} />
          <Vocabulary label="Resultado negativo" value={lost} onChange={setLost} />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium">Etapas do Kanban</h3>
            <p className="text-xs text-muted-foreground">
              Use as setas para ordenar. Marque claramente ganho, perda ou atendimento humano.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() =>
              execute(
                () =>
                  savePipelineStage(pipeline.id, {
                    name: "Nova etapa",
                    color: "#3b82f6",
                    requires_human: false,
                    is_won: false,
                    is_lost: false,
                  }),
                "Etapa criada.",
              )
            }
          >
            <Plus size={15} /> Etapa
          </Button>
        </div>
        <div className="space-y-2">
          {pipeline.stages.map((stage, index) => (
            <StageEditor
              key={stage.id}
              pipeline={pipeline}
              stage={stage}
              index={index}
              total={pipeline.stages.length}
              execute={execute}
              pending={isPending}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium">Campos personalizados</h3>
            <p className="text-xs text-muted-foreground">Crie campos sem escrever JSON.</p>
          </div>
          <Button variant="outline" onClick={addField}>
            <Plus size={15} /> Campo
          </Button>
        </div>
        {fields.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Nenhum campo personalizado.
          </p>
        ) : (
          <div className="space-y-2">
            {fields.map((field, index) => {
              const hasOptions = field.type === "select" || field.type === "multiselect";
              return (
                <div key={`${field.key}-${index}`} className="space-y-2 rounded-md border p-3">
                  <div className="grid gap-2 md:grid-cols-[1fr_170px_170px_130px_auto]">
                    <Input
                      value={field.label}
                      onChange={(e) =>
                        updateField(index, {
                          label: e.target.value,
                          key: keyFromLabel(e.target.value) || field.key,
                        })
                      }
                      aria-label="Nome do campo"
                    />
                    <select
                      className="h-10 rounded-md border bg-background px-3 text-sm"
                      value={field.type}
                      onChange={(e) =>
                        updateField(index, {
                          type: e.target.value,
                          options: ["select", "multiselect"].includes(e.target.value)
                            ? (field.options ?? [])
                            : undefined,
                        })
                      }
                    >
                      {FIELD_TYPES.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <select
                      className="h-10 rounded-md border bg-background px-3 text-sm"
                      value={field.visibility ?? "commercial"}
                      onChange={(event) =>
                        updateField(index, {
                          visibility: event.target.value as CustomFieldDef["visibility"],
                        })
                      }
                      aria-label="Privacidade do campo"
                    >
                      <option value="commercial">Dado comercial</option>
                      <option value="human_only">Somente humanos</option>
                      <option value="ai_allowed">Permitido para IA</option>
                    </select>
                    <label className="flex items-center gap-2 text-sm">
                      <Switch
                        checked={field.required ?? false}
                        onCheckedChange={(checked) => updateField(index, { required: checked })}
                      />{" "}
                      Obrigatório
                    </label>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setFields((items) => items.filter((_, i) => i !== index))}
                      aria-label="Remover campo"
                    >
                      <Trash size={16} />
                    </Button>
                  </div>
                  {hasOptions ? (
                    <div className="space-y-1">
                      <Label className="text-xs">Opções disponíveis, separadas por vírgula</Label>
                      <Input
                        value={(field.options ?? []).map((option) => option.label).join(", ")}
                        onChange={(e) =>
                          updateField(index, {
                            options: e.target.value
                              .split(",")
                              .map((value) => value.trim())
                              .filter(Boolean)
                              .map((label) => ({ label, value: keyFromLabel(label) || label })),
                          })
                        }
                        placeholder="Ex.: Residencial, Comercial, Rural"
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="font-medium">Motivos de perda</h3>
          <p className="text-xs text-muted-foreground">
            A equipe escolhe um destes motivos ao encerrar um negócio como perdido.
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            value={reasonDraft}
            onChange={(e) => setReasonDraft(e.target.value)}
            placeholder="Ex.: Sem retorno"
          />
          <Button
            variant="outline"
            onClick={() => {
              const value = reasonDraft.trim();
              if (value && !reasons.includes(value)) setReasons((r) => [...r, value]);
              setReasonDraft("");
            }}
          >
            Adicionar
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {reasons.map((reason) => (
            <span
              key={reason}
              className="inline-flex items-center gap-1 rounded-full border bg-muted px-3 py-1 text-sm"
            >
              {reason}
              <button
                onClick={() => setReasons((items) => items.filter((item) => item !== reason))}
                aria-label={`Remover ${reason}`}
              >
                <Trash size={13} />
              </button>
            </span>
          ))}
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={saveConfiguration} disabled={isPending}>
          {isPending ? "Salvando…" : "Salvar alterações"}
        </Button>
      </div>
    </Card>
  );
}

function Vocabulary({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function StageEditor({
  pipeline,
  stage,
  index,
  total,
  execute,
  pending,
}: {
  pipeline: PipelineRow;
  stage: StageRow;
  index: number;
  total: number;
  execute: (action: () => Promise<{ ok: boolean; error?: string }>, success: string) => void;
  pending: boolean;
}) {
  const [draft, setDraft] = useState(stage);
  const [migrationTarget, setMigrationTarget] = useState("");
  const otherStages = pipeline.stages.filter((item) => item.id !== stage.id);
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="grid gap-3 xl:grid-cols-[40px_minmax(170px,1fr)_70px_130px_110px_100px_100px_100px_auto] xl:items-center">
        <span className="text-center text-sm font-medium text-muted-foreground">{index + 1}</span>
        <Input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          aria-label={`Nome da etapa ${index + 1}`}
        />
        <input
          type="color"
          value={draft.color ?? "#64748b"}
          onChange={(e) => setDraft({ ...draft, color: e.target.value })}
          className="h-10 w-full rounded border bg-background p-1"
          aria-label="Cor da etapa"
        />
        <select
          className="h-10 rounded-md border bg-background px-2 text-xs"
          value={draft.agent_stage_hint ?? ""}
          onChange={(e) =>
            setDraft({ ...draft, agent_stage_hint: (e.target.value || null) as StageHint | null })
          }
        >
          {HINTS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Input
          type="number"
          min={1}
          max={8760}
          value={draft.expected_duration_hours ?? ""}
          onChange={(e) =>
            setDraft({
              ...draft,
              expected_duration_hours: e.target.value ? Number(e.target.value) : null,
            })
          }
          placeholder="Horas"
          aria-label="Duração esperada em horas"
        />
        <label className="flex items-center gap-2 text-xs">
          <Switch
            checked={draft.requires_human}
            onCheckedChange={(checked) => setDraft({ ...draft, requires_human: checked })}
          />{" "}
          Humano
        </label>
        <label className="flex items-center gap-2 text-xs">
          <Switch
            checked={draft.is_won}
            onCheckedChange={(checked) =>
              setDraft({ ...draft, is_won: checked, is_lost: checked ? false : draft.is_lost })
            }
          />{" "}
          Ganho
        </label>
        <label className="flex items-center gap-2 text-xs">
          <Switch
            checked={draft.is_lost}
            onCheckedChange={(checked) =>
              setDraft({ ...draft, is_lost: checked, is_won: checked ? false : draft.is_won })
            }
          />{" "}
          Perdido
        </label>
        <div className="flex justify-end gap-1">
          <Button
            size="icon"
            variant="ghost"
            disabled={pending || index === 0}
            onClick={() =>
              execute(() => movePipelineStage(pipeline.id, stage.id, -1), "Etapa movida.")
            }
            aria-label="Mover para cima"
          >
            <ArrowCounterClockwise size={15} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            disabled={pending || index === total - 1}
            onClick={() =>
              execute(() => movePipelineStage(pipeline.id, stage.id, 1), "Etapa movida.")
            }
            aria-label="Mover para baixo"
          >
            <ArrowClockwise size={15} />
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              execute(() => savePipelineStage(pipeline.id, draft), "Etapa atualizada.")
            }
          >
            Salvar
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
        <Label className="text-xs text-muted-foreground">Ao arquivar, mover negócios para:</Label>
        <select
          className="h-9 min-w-52 rounded-md border bg-background px-2 text-xs"
          value={migrationTarget}
          onChange={(e) => setMigrationTarget(e.target.value)}
        >
          <option value="">Somente se estiver vazia</option>
          {otherStages.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending || otherStages.length === 0}
          onClick={() =>
            execute(
              () => archivePipelineStage(pipeline.id, stage.id, migrationTarget || undefined),
              "Etapa arquivada.",
            )
          }
        >
          <Trash size={15} /> Arquivar etapa
        </Button>
      </div>
    </div>
  );
}
