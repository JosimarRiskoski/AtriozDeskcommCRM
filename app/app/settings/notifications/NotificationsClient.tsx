"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS } from "@/lib/schemas/settings";

type Category = (typeof NOTIFICATION_CATEGORIES)[number];
type Channel = (typeof NOTIFICATION_CHANNELS)[number];
type Pref = { category: Category; channel: Channel; enabled: boolean };

const CATEGORY_LABELS: Record<Category, { label: string; description: string }> = {
  lead_assigned: { label: "Lead atribuído a você", description: "Um negócio passou para sua responsabilidade." },
  human_handoff: { label: "Atendimento humano solicitado", description: "A IA ou o cliente pediu ajuda da equipe." },
  client_new: { label: "Cliente novo", description: "Um contato novo entrou no CRM." },
  file_received: { label: "Arquivo recebido", description: "Chegou imagem, áudio, vídeo ou documento pelo WhatsApp." },
  file_rejected: { label: "Arquivo recusado", description: "Formato ou tamanho impediu o armazenamento." },
  whatsapp_disconnected: { label: "WhatsApp desconectado", description: "Uma conexão parou e precisa de diagnóstico." },
  send_failed: { label: "Falha persistente de envio", description: "Uma mensagem não chegou ao provedor." },
  ai_failure: { label: "Falha do agente de IA", description: "Crédito, credencial ou provedor impediu a resposta." },
  campaign_interrupted: { label: "Campanha interrompida", description: "Uma campanha parou por erro ou proteção." },
  team_invite_failed: { label: "Convite de equipe falhou", description: "O convite não pôde ser entregue por e-mail." },
  lead_won: { label: "Negócio ganho", description: "Um card foi concluído como ganho." },
  lead_lost: { label: "Negócio perdido", description: "Um card foi encerrado como perdido." },
  mention: { label: "Você foi mencionado", description: "Uma pessoa chamou sua atenção em um item." },
};

export function NotificationsClient({ canTest }: { canTest: boolean }) {
  const [prefs, setPrefs] = useState<Pref[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/notification-preferences", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Falha ao carregar preferências.");
      setPrefs(json.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar preferências.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const map = useMemo(() => new Map(prefs.map((p) => [`${p.category}:${p.channel}`, p.enabled])), [prefs]);

  function toggle(category: Category, channel: Channel, enabled: boolean) {
    setPrefs((current) => {
      const found = current.some((p) => p.category === category && p.channel === channel);
      return found
        ? current.map((p) => p.category === category && p.channel === channel ? { ...p, enabled } : p)
        : [...current, { category, channel, enabled }];
    });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/v1/notification-preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefs }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Não foi possível salvar.");
      toast.success("Preferências de notificação salvas.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    const res = await fetch("/api/v1/notifications/test", { method: "POST" });
    if (res.ok) {
      toast.success("Teste criado. Ele já deve aparecer no sino.");
      window.dispatchEvent(new Event("notifications:refresh"));
    } else {
      const json = await res.json().catch(() => null);
      toast.error(json?.error?.message ?? "Não foi possível criar o teste.");
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-blue-500/30 bg-blue-500/5 p-4 text-sm">
        Alertas aparecem no CRM e, quando habilitado, também são enviados por e-mail. O canal Push fica oculto até existir entrega real.
      </Card>
      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-[minmax(0,1fr)_110px_110px] border-b bg-muted/30 px-4 py-3 text-sm font-medium">
          <span>Evento</span><span className="text-center">No CRM</span><span className="text-center">E-mail</span>
        </div>
        {NOTIFICATION_CATEGORIES.map((category) => (
          <div key={category} className="grid grid-cols-[minmax(0,1fr)_110px_110px] items-center border-b px-4 py-3 last:border-0">
            <div><p className="text-sm font-medium">{CATEGORY_LABELS[category].label}</p><p className="text-xs text-muted-foreground">{CATEGORY_LABELS[category].description}</p></div>
            {NOTIFICATION_CHANNELS.slice().reverse().map((channel) => (
              <div key={channel} className="flex justify-center">
                <Switch
                  checked={map.get(`${category}:${channel}`) ?? false}
                  onCheckedChange={(checked) => toggle(category, channel, checked)}
                  disabled={loading || saving}
                  aria-label={`${CATEGORY_LABELS[category].label} por ${channel === "in_app" ? "CRM" : "e-mail"}`}
                />
              </div>
            ))}
          </div>
        ))}
      </Card>
      <div className="flex flex-wrap justify-end gap-2">
        {canTest ? <Button variant="outline" onClick={sendTest} disabled={loading || saving}>Enviar teste</Button> : null}
        <Button onClick={save} disabled={loading || saving}>{saving ? "Salvando…" : "Salvar preferências"}</Button>
      </div>
    </div>
  );
}
