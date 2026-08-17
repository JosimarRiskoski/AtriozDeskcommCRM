"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CheckCircle, CircleNotch, Warning } from "@/lib/ui/icons";

type Settings = {
  organization_id?: string;
  dataset_id?: string;
  graph_api_version?: string;
  event_name?: string;
  conversion_label?: string;
  currency?: string;
  test_event_code?: string | null;
  require_consent?: boolean;
  enabled?: boolean;
  updated_at?: string;
  delivery_summary?: {
    sent: number;
    failed: number;
    last: {
      status: string;
      sent_at: string | null;
      last_error: string | null;
      requested_at: string | null;
    } | null;
  };
};

export function MetaCapiForm() {
  const [current, setCurrent] = useState<Settings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [requireConsent, setRequireConsent] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<{ valid: boolean; name?: string | null } | null>(
    null,
  );

  useEffect(() => {
    fetch("/api/v1/settings/meta-capi")
      .then((response) => response.json())
      .then((json) => {
        const data = (json.data ?? {}) as Settings;
        setCurrent(data);
        setEnabled(data.enabled === true);
        setRequireConsent(data.require_consent !== false);
      })
      .catch(() => setCurrent({}));
  }, []);

  if (current === null) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  async function validateConnection() {
    setValidating(true);
    setValidation(null);
    try {
      const response = await fetch("/api/v1/settings/meta-capi/validate", { method: "POST" });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "A Meta nao confirmou a conexao.");
      setValidation({ valid: true, name: json.data?.dataset_name ?? null });
      toast.success("Dataset e token validados pela Meta.");
    } catch (error) {
      setValidation({ valid: false });
      toast.error(error instanceof Error ? error.message : "A Meta nao confirmou a conexao.");
    } finally {
      setValidating(false);
    }
  }

  async function save(formData: FormData) {
    setSaving(true);
    const body = {
      dataset_id: formData.get("dataset_id"),
      access_token: String(formData.get("access_token") || "") || undefined,
      graph_api_version: formData.get("graph_api_version"),
      event_name: formData.get("event_name"),
      conversion_label: formData.get("conversion_label"),
      currency: formData.get("currency"),
      test_event_code: String(formData.get("test_event_code") || "") || null,
      require_consent: requireConsent,
      enabled,
    };
    try {
      const response = await fetch("/api/v1/settings/meta-capi", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "Falha ao salvar.");
      setCurrent((value) => ({ ...value, ...json.data }));
      toast.success("Configuração da Meta salva.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  const summary = current.delivery_summary;
  return (
    <form action={save} className="max-w-4xl space-y-5">
      <Card className="space-y-4 p-5">
        <div>
          <Badge variant="outline">Etapa 1</Badge>
          <h2 className="mt-2 font-semibold">Conexão com a Meta</h2>
          <p className="text-sm text-muted-foreground">
            Credenciais do conjunto de dados usado no Gerenciador de Eventos.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="meta-dataset">Dataset/Pixel ID</Label>
            <Input
              id="meta-dataset"
              name="dataset_id"
              required
              defaultValue={current.dataset_id ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="meta-version">Versão da Graph API</Label>
            <Input
              id="meta-version"
              name="graph_api_version"
              required
              defaultValue={current.graph_api_version ?? "v25.0"}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="meta-token">Token de acesso</Label>
            <Input
              id="meta-token"
              name="access_token"
              type="password"
              placeholder={
                current.organization_id ? "Deixe vazio para manter o token atual" : "Cole o token"
              }
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={!current.organization_id || validating}
            onClick={() => void validateConnection()}
          >
            {validating ? <CircleNotch size={15} className="mr-2 animate-spin" /> : null} Validar
            Dataset e token
          </Button>
          {validation?.valid ? (
            <span className="inline-flex items-center gap-1 text-sm text-emerald-500">
              <CheckCircle size={15} /> Conexao confirmada
              {validation.name ? `: ${validation.name}` : ""}
            </span>
          ) : null}
          {validation?.valid === false ? (
            <span className="inline-flex items-center gap-1 text-sm text-destructive">
              <Warning size={15} /> Conexao nao validada
            </span>
          ) : null}
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div>
          <Badge variant="outline">Etapa 2</Badge>
          <h2 className="mt-2 font-semibold">Conversão comercial</h2>
          <p className="text-sm text-muted-foreground">
            O usuário verá este marco antes de confirmar o único envio da oportunidade.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="meta-label">Nome no CRM</Label>
            <Input
              id="meta-label"
              name="conversion_label"
              defaultValue={current.conversion_label ?? "Venda fechada"}
              placeholder="Ex.: Lead qualificado"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="meta-event">Evento enviado</Label>
            <Input
              id="meta-event"
              name="event_name"
              defaultValue={current.event_name ?? "Purchase"}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="meta-currency">Moeda</Label>
            <Input
              id="meta-currency"
              name="currency"
              defaultValue={current.currency ?? "BRL"}
              maxLength={3}
            />
          </div>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div>
          <Badge variant="outline">Etapa 3</Badge>
          <h2 className="mt-2 font-semibold">Privacidade e teste</h2>
        </div>
        <div className="space-y-2">
          <Label htmlFor="meta-test">Código de evento de teste</Label>
          <Input
            id="meta-test"
            name="test_event_code"
            defaultValue={current.test_event_code ?? ""}
            placeholder="TEST12345"
          />
          <p className="text-xs text-muted-foreground">
            Enquanto preenchido, os cliques manuais aparecem em Test Events. Remova somente depois
            da validação.
          </p>
        </div>
        <div className="flex items-center justify-between rounded-md border p-4">
          <div>
            <div className="font-medium">Exigir consentimento Meta CAPI</div>
            <div className="text-xs text-muted-foreground">
              Bloqueia o envio quando o contato não possui consentimento registrado.
            </div>
          </div>
          <Switch checked={requireConsent} onCheckedChange={setRequireConsent} />
        </div>
        <div className="flex items-center justify-between rounded-md border p-4">
          <div>
            <div className="font-medium">Ativar envios manuais</div>
            <div className="text-xs text-muted-foreground">
              Ativar não envia nada sozinho. Cada oportunidade exige confirmação.
            </div>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
      </Card>

      {summary ? (
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1 text-sm text-emerald-500">
              <CheckCircle size={16} /> {summary.sent} envios recentes
            </span>
            <span className="inline-flex items-center gap-1 text-sm text-amber-500">
              <Warning size={16} /> {summary.failed} falhas recentes
            </span>
            {summary.last ? (
              <span className="text-xs text-muted-foreground">
                Último estado: {summary.last.status}
              </span>
            ) : null}
          </div>
        </Card>
      ) : null}
      <Button type="submit" disabled={saving}>
        {saving ? "Salvando..." : "Salvar configuração"}
      </Button>
    </form>
  );
}
