"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api/client";
import {
  DEFAULT_HUMAN_SUPPORT_SETTINGS,
  type HumanSupportSettings,
} from "@/lib/human-support/settings";

type Connection = {
  id: string;
  display_name: string | null;
  phone_number: string | null;
  status: string;
};
type Group = { chat_id: string; name: string; channel_session_id: string };
type ResponseData = { settings: HumanSupportSettings; connections: Connection[]; groups: Group[] };

const RULES: Array<[keyof HumanSupportSettings["handoff_rules"], string]> = [
  ["customer_request", "Cliente pediu uma pessoa"],
  ["low_confidence", "IA com baixa confiança"],
  ["missing_information", "Informação necessária não encontrada"],
  ["repeated_failure", "Falhas repetidas"],
  ["complaint_or_risk", "Reclamação ou risco"],
  ["calculation", "Cálculo ou simulação"],
  ["commercial_exception", "Exceção comercial"],
  ["document_review", "Documento que exige análise humana"],
  ["tool_unavailable", "Ferramenta indisponível"],
];
const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export function HumanSupportSettingsClient() {
  const [value, setValue] = useState<HumanSupportSettings>(DEFAULT_HUMAN_SUPPORT_SETTINGS);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [manualGroupId, setManualGroupId] = useState("");
  const [manualGroupName, setManualGroupName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    apiClient
      .get<{ data: ResponseData }>("/api/v1/settings/human-support")
      .then((res) => {
        setValue(res.data.settings);
        setConnections(res.data.connections);
        setGroups(res.data.groups);
      })
      .finally(() => setLoading(false));
  }, []);
  const set = <K extends keyof HumanSupportSettings>(key: K, next: HumanSupportSettings[K]) =>
    setValue((current) => ({ ...current, [key]: next }));
  const setRule = (key: keyof HumanSupportSettings["handoff_rules"], next: boolean) =>
    setValue((current) => ({
      ...current,
      handoff_rules: { ...current.handoff_rules, [key]: next },
    }));
  const save = async () => {
    setSaving(true);
    try {
      const res = await apiClient.put<{ data: HumanSupportSettings }>(
        "/api/v1/settings/human-support",
        value,
      );
      setValue(res.data);
      toast.success("Configuração de atendimento humano salva.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar a configuração.");
    } finally {
      setSaving(false);
    }
  };
  const sendGroupTest = async () => {
    try {
      await apiClient.post("/api/v1/settings/human-support/test-group", {});
      toast.success("Mensagem de teste enviada ao grupo.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar o teste.");
    }
  };
  if (loading) return <p className="text-sm text-muted-foreground">Carregando configuração…</p>;
  const availableGroups = groups.filter(
    (group) =>
      !value.whatsapp_connection_id || group.channel_session_id === value.whatsapp_connection_id,
  );
  return (
    <div className="space-y-5">
      <Card className="space-y-4 p-4">
        <div>
          <h2 className="font-semibold">Prazos e canais</h2>
          <p className="text-sm text-muted-foreground">
            O primeiro aviso chama a equipe; a escalada destaca o caso como atrasado.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField
            label="Primeiro aviso após (minutos)"
            value={value.first_alert_minutes}
            onChange={(n) => set("first_alert_minutes", n)}
          />
          <NumberField
            label="Escalar após (minutos)"
            value={value.escalation_minutes}
            onChange={(n) => set("escalation_minutes", n)}
          />
          <NumberField
            label="Repetir alerta a cada (minutos)"
            value={value.repeat_alert_minutes}
            onChange={(n) => set("repeat_alert_minutes", n)}
          />
          <NumberField
            label="Máximo de lembretes"
            value={value.max_alert_repeats}
            onChange={(n) => set("max_alert_repeats", n)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Toggle
            label="Avisar no CRM"
            checked={value.notify_in_app}
            onChange={(v) => set("notify_in_app", v)}
          />
          <Toggle
            label="Avisar por e-mail"
            checked={value.notify_email}
            onChange={(v) => set("notify_email", v)}
          />
          <Toggle
            label="Avisar grupo WhatsApp"
            checked={value.notify_whatsapp_group}
            onChange={(v) => {
              if (v && (!value.whatsapp_connection_id || !value.whatsapp_group_chat_id)) {
                toast.error("Escolha a conexão e o grupo antes de ativar este aviso.");
                return;
              }
              set("notify_whatsapp_group", v);
            }}
          />
        </div>
        <Toggle
          label="Encerrar alertas quando o caso for resolvido"
          checked={value.close_alert_on_resolution}
          onChange={(v) => set("close_alert_on_resolution", v)}
        />
        <div className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
          <span>Responsáveis e fila padrão são definidos na tela Equipe.</span>
          <Button asChild size="sm" variant="outline">
            <Link href="/app/team">Configurar responsáveis</Link>
          </Button>
        </div>
        <BusinessHoursEditor
          value={value.business_hours}
          onChange={(hours) => set("business_hours", hours)}
        />
      </Card>
      <Card className="space-y-4 p-4">
        <div>
          <h2 className="font-semibold">Quando abrir um caso automaticamente</h2>
          <p className="text-sm text-muted-foreground">
            Estas regras são da organização e podem ser adaptadas para outros nichos.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {RULES.map(([key, label]) => (
            <Toggle
              key={key}
              label={label}
              checked={Boolean(value.handoff_rules[key])}
              onChange={(v) => setRule(key, v)}
            />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextList
            label="Documentos que sempre exigem análise humana"
            value={value.handoff_rules.required_document_types}
            onChange={(items) =>
              setValue((c) => ({
                ...c,
                handoff_rules: { ...c.handoff_rules, required_document_types: items },
              }))
            }
          />
          <TextList
            label="Palavras ou intenções personalizadas"
            value={value.handoff_rules.custom_intents}
            onChange={(items) =>
              setValue((c) => ({
                ...c,
                handoff_rules: { ...c.handoff_rules, custom_intents: items },
              }))
            }
          />
        </div>
      </Card>
      <Card className="space-y-4 p-4">
        <div>
          <h2 className="font-semibold">Grupo dos gestores no WhatsApp</h2>
          <p className="text-sm text-muted-foreground">
            O CRM envia nome, telefone, resumo do problema e o identificador do caso. Nada é enviado
            enquanto a opção acima estiver desligada.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Conexão usada para avisar"
            value={value.whatsapp_connection_id ?? ""}
            onChange={(v) => {
              set("whatsapp_connection_id", v || null);
              set("whatsapp_group_chat_id", null);
            }}
          >
            <option value="">Escolha uma conexão</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name ?? c.phone_number ?? c.id} — {c.status}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Grupo encontrado"
            value={value.whatsapp_group_chat_id ?? ""}
            onChange={(v) => {
              const group = availableGroups.find((g) => g.chat_id === v);
              set("whatsapp_group_chat_id", v || null);
              set("whatsapp_group_name", group?.name ?? null);
            }}
          >
            <option value="">Escolha um grupo</option>
            {availableGroups.map((g) => (
              <option key={g.chat_id} value={g.chat_id}>
                {g.name}
              </option>
            ))}
          </SelectField>
        </div>
        {availableGroups.length === 0 ? (
          <div className="space-y-3 rounded-md border border-dashed p-3">
            <p className="text-sm font-medium">Ainda não há grupos encontrados nesta conexão.</p>
            <p className="text-xs text-muted-foreground">
              O CRM aprende os grupos quando recebe ou registra uma mensagem deles. Se você já
              possui o identificador do grupo, pode cadastrá-lo abaixo para habilitar os avisos.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="manualGroupId">Identificador do grupo</Label>
                <Input
                  id="manualGroupId"
                  placeholder="1234567890-123456789@g.us"
                  value={manualGroupId}
                  onChange={(event) => setManualGroupId(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="manualGroupName">Nome para exibir</Label>
                <Input
                  id="manualGroupName"
                  placeholder="Gestores"
                  value={manualGroupName}
                  onChange={(event) => setManualGroupName(event.target.value)}
                />
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!value.whatsapp_connection_id || !manualGroupId.trim()}
              onClick={() => {
                const groupId = manualGroupId.trim();
                if (!/^\d+(?:-\d+)?@g\.us$/.test(groupId)) {
                  toast.error("Use o identificador completo do grupo, terminado em @g.us.");
                  return;
                }
                set("whatsapp_group_chat_id", groupId);
                set("whatsapp_group_name", manualGroupName.trim() || groupId);
                toast.success("Grupo preparado. Agora ative o aviso e salve a configuração.");
              }}
            >
              Usar este grupo
            </Button>
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Toggle
            label="Handoffs"
            checked={value.group_notify_handoffs}
            onChange={(v) => set("group_notify_handoffs", v)}
          />
          <Toggle
            label="Erros do CRM"
            checked={value.group_notify_crm_errors}
            onChange={(v) => set("group_notify_crm_errors", v)}
          />
          <Toggle
            label="WhatsApp desconectado"
            checked={value.group_notify_connection_down}
            onChange={(v) => set("group_notify_connection_down", v)}
          />
          <Toggle
            label="Limite da IA"
            checked={value.group_notify_ai_budget}
            onChange={(v) => set("group_notify_ai_budget", v)}
          />
          <Toggle
            label="Campanha pausada"
            checked={value.group_notify_campaign_paused}
            onChange={(v) => set("group_notify_campaign_paused", v)}
          />
        </div>
        <Toggle
          label="Permitir comandos dos gestores no grupo"
          checked={value.allow_group_replies}
          onChange={(v) => set("allow_group_replies", v)}
        />
        <TextList
          label="Telefones dos gestores autorizados"
          value={value.authorized_manager_phones}
          onChange={(items) => set("authorized_manager_phones", items)}
        />
        <SelectField
          label="Como mostrar o telefone no grupo"
          value={value.group_phone_display}
          onChange={(next) => set("group_phone_display", next as "masked" | "full")}
        >
          <option value="masked">Mascarado (recomendado)</option>
          <option value="full">Completo</option>
        </SelectField>
        <div className="space-y-2">
          <Label>Modelo da mensagem</Label>
          <Textarea
            rows={6}
            value={value.group_message_template}
            onChange={(e) => set("group_message_template", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Campos disponíveis:{" "}
            {
              "{{case_id}}, {{contact_name}}, {{contact_phone}}, {{summary}}, {{urgency}}, {{assignee_name}}, {{crm_link}}"
            }
            .
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={!value.whatsapp_connection_id || !value.whatsapp_group_chat_id}
          onClick={() => void sendGroupTest()}
        >
          Enviar teste ao grupo
        </Button>
      </Card>
      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Salvando…" : "Salvar configuração"}
        </Button>
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
      <Switch checked={checked} onCheckedChange={onChange} />
      {label}
    </label>
  );
}
function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-2">
      <Label>{label}</Label>
      <Input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-2">
      <Label>{label}</Label>
      <select
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </label>
  );
}
function TextList({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <label className="space-y-2">
      <Label>{label}</Label>
      <Textarea
        rows={4}
        value={value.join("\n")}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(/\n|,/)
              .map((v) => v.trim())
              .filter(Boolean),
          )
        }
      />
      <p className="text-xs text-muted-foreground">Um item por linha.</p>
    </label>
  );
}

function BusinessHoursEditor({
  value,
  onChange,
}: {
  value: HumanSupportSettings["business_hours"];
  onChange: (value: HumanSupportSettings["business_hours"]) => void;
}) {
  const windows = value.windows;
  const toggleDay = (dow: number, enabled: boolean) =>
    onChange({
      ...value,
      windows: enabled
        ? [...windows, { dow, start: "08:00", end: "18:00" }].sort((a, b) => a.dow - b.dow)
        : windows.filter((item) => item.dow !== dow),
    });
  return (
    <div className="space-y-3 rounded-md border p-3">
      <Toggle
        label="Considerar horário comercial nos alertas"
        checked={value.enabled}
        onChange={(enabled) => onChange({ ...value, enabled })}
      />
      {value.enabled ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {WEEKDAYS.map((label, dow) => {
            const window = windows.find((item) => item.dow === dow);
            return (
              <div key={label} className="rounded-md border p-2">
                <label className="flex items-center gap-2 text-xs font-medium">
                  <Switch
                    checked={Boolean(window)}
                    onCheckedChange={(checked) => toggleDay(dow, checked)}
                  />
                  {label}
                </label>
                {window ? (
                  <div className="mt-2 flex items-center gap-1">
                    <Input
                      aria-label={`Início de ${label}`}
                      type="time"
                      value={window.start}
                      onChange={(e) =>
                        onChange({
                          ...value,
                          windows: windows.map((item) =>
                            item.dow === dow ? { ...item, start: e.target.value } : item,
                          ),
                        })
                      }
                    />
                    <span className="text-xs">até</span>
                    <Input
                      aria-label={`Fim de ${label}`}
                      type="time"
                      value={window.end}
                      onChange={(e) =>
                        onChange({
                          ...value,
                          windows: windows.map((item) =>
                            item.dow === dow ? { ...item, end: e.target.value } : item,
                          ),
                        })
                      }
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
