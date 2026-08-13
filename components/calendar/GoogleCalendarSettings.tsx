"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { connectGoogleCalendar } from "@/app/actions/integrations/connectGoogleCalendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

interface Settings {
  google_account_email: string | null;
  status: string;
  calendar_id: string;
  timezone: string;
  default_duration_minutes: number;
  reminder_24h_enabled: boolean;
  reminder_1h_enabled: boolean;
  reminder_24h_template: string;
  reminder_1h_template: string;
  last_error: string | null;
  last_sync_at: string | null;
}

export function GoogleCalendarSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, startConnecting] = useTransition();

  async function load() {
    setLoading(true);
    const response = await fetch("/api/v1/calendar/settings");
    const json = (await response.json()) as { data?: Settings | null };
    if (response.ok) setSettings(json.data ?? null);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  function connect() {
    startConnecting(async () => {
      const result = await connectGoogleCalendar();
      if (result?.ok === false) {
        const messages = {
          auth_required: "Faça login novamente.",
          no_active_org: "Selecione uma organização.",
          forbidden: "Somente administradores podem conectar o Google Agenda.",
          not_configured: "As credenciais Google ainda não foram configuradas no servidor.",
        };
        toast.error(messages[result.error]);
      }
    });
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const response = await fetch("/api/v1/calendar/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      const json = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(json.error?.message || "Não foi possível salvar.");
      toast.success("Configurações da agenda salvas.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Carregando integração…</p>;
  if (!settings || settings.status === "disconnected") {
    return (
      <Card className="space-y-4 p-5">
        <div><h2 className="font-semibold">Conectar Google Agenda</h2><p className="mt-1 text-sm text-muted-foreground">Autorize a criação de eventos, consultas de disponibilidade e links do Google Meet.</p></div>
        <Button onClick={connect} disabled={connecting}>{connecting ? "Abrindo Google…" : "Conectar com Google"}</Button>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div><div className="font-medium">{settings.google_account_email || "Conta Google conectada"}</div><div className="text-xs text-muted-foreground">Última sincronização: {settings.last_sync_at ? new Date(settings.last_sync_at).toLocaleString("pt-BR") : "ainda não realizada"}</div></div>
        <div className="flex items-center gap-2"><Badge variant={settings.status === "connected" ? "success" : "warning"}>{settings.status === "connected" ? "Conectado" : settings.status}</Badge><Button variant="outline" size="sm" onClick={connect}>Reconectar</Button></div>
      </Card>
      <Card className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="calendar-id">Agenda do Google</Label><Input id="calendar-id" value={settings.calendar_id} onChange={(event) => setSettings({ ...settings, calendar_id: event.target.value })} /><p className="text-xs text-muted-foreground">Use “primary” para a agenda principal.</p></div>
          <div className="space-y-2"><Label htmlFor="calendar-timezone">Fuso horário</Label><Input id="calendar-timezone" value={settings.timezone} onChange={(event) => setSettings({ ...settings, timezone: event.target.value })} /></div>
        </div>
      </Card>
      <Card className="space-y-5 p-5">
        <div><h2 className="font-semibold">Mensagens fixas de lembrete</h2><p className="text-sm text-muted-foreground">A Sophia não altera estes textos. Variáveis aceitas: {"{{nome}}, {{data}}, {{hora}}, {{local}}, {{link_meet}}, {{local_ou_link}}"}.</p></div>
        <div className="space-y-2"><label className="flex items-center justify-between text-sm font-medium"><span>Enviar 1 dia antes</span><Switch checked={settings.reminder_24h_enabled} onCheckedChange={(value) => setSettings({ ...settings, reminder_24h_enabled: value })} /></label><Textarea rows={3} value={settings.reminder_24h_template} onChange={(event) => setSettings({ ...settings, reminder_24h_template: event.target.value })} /></div>
        <div className="space-y-2"><label className="flex items-center justify-between text-sm font-medium"><span>Enviar 1 hora antes</span><Switch checked={settings.reminder_1h_enabled} onCheckedChange={(value) => setSettings({ ...settings, reminder_1h_enabled: value })} /></label><Textarea rows={3} value={settings.reminder_1h_template} onChange={(event) => setSettings({ ...settings, reminder_1h_template: event.target.value })} /></div>
        <Button onClick={() => void save()} disabled={saving}>{saving ? "Salvando…" : "Salvar configurações"}</Button>
      </Card>
    </div>
  );
}
