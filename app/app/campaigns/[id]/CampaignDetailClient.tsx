"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { BackNavigation } from "@/components/shell/BackNavigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CAMPAIGN_STATUS_LABELS, RECIPIENT_STATUS_LABELS } from "@/lib/campaigns/presentation";

type Recipient = {
  id: string;
  position: number;
  name: string | null;
  phone_normalized: string;
  status: string;
  text_sent_at: string | null;
  audio_sent_at: string | null;
  sent_at: string | null;
  replied_at: string | null;
  attempts: number;
  last_error_code: string | null;
  last_error_message: string | null;
};

type Detail = {
  campaign: {
    id: string;
    name: string;
    status: string;
    interval_seconds: number;
    delay_before_audio_seconds: number;
    ai_mode: string;
    next_dispatch_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    audio_storage_path: string | null;
  };
  session: { display_name: string | null; status: string } | null;
  recipients: Recipient[];
  summary: {
    total: number;
    pending: number;
    processing: number;
    sent: number;
    replied: number;
    failed: number;
    finished: number;
    progress: number;
  };
};

const dateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
        new Date(value),
      )
    : "—";

const campaignBadge = (status: string) =>
  status === "completed"
    ? "success"
    : status === "cancelled"
      ? "error"
      : status === "paused"
        ? "warning"
        : "info";

const recipientBadge = (status: string) =>
  status === "replied" || status === "sent"
    ? "success"
    : status === "failed"
      ? "error"
      : status === "processing"
        ? "info"
        : "neutral";

export function CampaignDetailClient({ campaignId }: { campaignId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/v1/campaigns/${campaignId}`, { cache: "no-store" });
    const json = await response.json();
    if (!response.ok)
      throw new Error(json?.error?.message ?? "Não foi possível acompanhar a campanha.");
    setDetail(json.data);
    setError(null);
    setLoading(false);
  }, [campaignId]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void load().catch((reason) => {
        setError(
          reason instanceof Error ? reason.message : "Não foi possível acompanhar a campanha.",
        );
        setLoading(false);
      });
    }, 0);
    const refreshTimer = window.setInterval(() => void load().catch(() => undefined), 5000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(refreshTimer);
    };
  }, [load]);

  async function action(value: "pause" | "resume" | "cancel") {
    setBusy(true);
    const response = await fetch(`/api/v1/campaigns/${campaignId}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: value }),
    });
    const json = await response.json();
    if (!response.ok) toast.error(json?.error?.message ?? "Ação recusada.");
    else {
      toast.success("Campanha atualizada.");
      await load();
    }
    setBusy(false);
  }

  if (loading)
    return <div className="p-6 text-sm text-muted-foreground">Carregando acompanhamento…</div>;
  if (error || !detail)
    return (
      <div className="p-6 text-sm text-destructive">{error ?? "Campanha não encontrada."}</div>
    );

  const { campaign, summary, recipients, session } = detail;
  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-6">
      <header className="space-y-3">
        <BackNavigation fallbackHref="/app/campaigns" label="Voltar às campanhas" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">{campaign.name}</h1>
              <Badge variant={campaignBadge(campaign.status)}>
                {CAMPAIGN_STATUS_LABELS[campaign.status] ?? campaign.status}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Atualização automática a cada 5 segundos.
            </p>
          </div>
          <div className="flex gap-2">
            {["scheduled", "running"].includes(campaign.status) && (
              <Button disabled={busy} variant="outline" onClick={() => action("pause")}>
                Pausar
              </Button>
            )}
            {campaign.status === "paused" && (
              <Button disabled={busy} onClick={() => action("resume")}>
                Retomar
              </Button>
            )}
            {!["completed", "cancelled"].includes(campaign.status) && (
              <Button disabled={busy} variant="destructive" onClick={() => action("cancel")}>
                Cancelar
              </Button>
            )}
          </div>
        </div>
      </header>

      <Card className="p-5">
        <div className="mb-2 flex justify-between text-sm">
          <span>Progresso da campanha</span>
          <b>{summary.progress}%</b>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-surface-elevated">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${summary.progress}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {summary.finished} de {summary.total} contatos processados
        </p>
      </Card>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Total", summary.total],
          ["Aguardando", summary.pending],
          ["Enviados", summary.sent],
          ["Responderam", summary.replied],
          ["Falhas", summary.failed],
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold">{value}</p>
          </Card>
        ))}
      </section>

      <Card className="grid gap-4 p-5 text-sm md:grid-cols-2 xl:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Conexão</p>
          <p className="font-medium">
            {session?.display_name || "WhatsApp"} · {session?.status || "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Próximo envio</p>
          <p className="font-medium">{dateTime(campaign.next_dispatch_at)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Cadência</p>
          <p className="font-medium">
            {Math.round(campaign.interval_seconds / 60)} min entre contatos
            {campaign.audio_storage_path
              ? ` · áudio após ${campaign.delay_before_audio_seconds}s`
              : ""}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">IA após resposta</p>
          <p className="font-medium">
            {campaign.ai_mode === "paused"
              ? "Pausada"
              : campaign.ai_mode === "active"
                ? "Ativa"
                : "Configuração geral"}
          </p>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b p-4">
          <h2 className="font-semibold">Destinatários</h2>
          <p className="text-xs text-muted-foreground">
            Veja quem recebeu, respondeu ou apresentou erro.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="bg-surface-elevated text-xs text-muted-foreground">
              <tr>
                <th className="p-3">#</th>
                <th className="p-3">Contato</th>
                <th className="p-3">Status</th>
                <th className="p-3">Texto</th>
                <th className="p-3">Áudio</th>
                <th className="p-3">Tentativas</th>
                <th className="p-3">Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((recipient) => (
                <tr key={recipient.id} className="border-t align-top">
                  <td className="p-3">{recipient.position + 1}</td>
                  <td className="p-3">
                    <b>{recipient.name || "Sem nome"}</b>
                    <div className="text-xs text-muted-foreground">
                      {recipient.phone_normalized}
                    </div>
                  </td>
                  <td className="p-3">
                    <Badge variant={recipientBadge(recipient.status)}>
                      {RECIPIENT_STATUS_LABELS[recipient.status] ?? recipient.status}
                    </Badge>
                  </td>
                  <td className="p-3">{dateTime(recipient.text_sent_at)}</td>
                  <td className="p-3">{dateTime(recipient.audio_sent_at)}</td>
                  <td className="p-3">{recipient.attempts}</td>
                  <td className="max-w-sm p-3 text-xs text-muted-foreground">
                    {recipient.last_error_message || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
