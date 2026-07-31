export const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  scheduled: "Agendada",
  running: "Em andamento",
  paused: "Pausada",
  cancelled: "Cancelada",
  completed: "Concluída",
};

export const RECIPIENT_STATUS_LABELS: Record<string, string> = {
  pending: "Aguardando",
  processing: "Enviando",
  sent: "Enviado",
  replied: "Respondeu",
  skipped: "Ignorado",
  failed: "Falhou",
  cancelled: "Cancelado",
};

export type CampaignRecipientSummary = {
  total: number;
  pending: number;
  processing: number;
  sent: number;
  replied: number;
  skipped: number;
  failed: number;
  cancelled: number;
  finished: number;
  progress: number;
};

export function summarizeCampaignRecipients(statuses: string[]): CampaignRecipientSummary {
  const summary: CampaignRecipientSummary = {
    total: statuses.length,
    pending: 0,
    processing: 0,
    sent: 0,
    replied: 0,
    skipped: 0,
    failed: 0,
    cancelled: 0,
    finished: 0,
    progress: 0,
  };

  for (const status of statuses) {
    if (status in summary && status !== "total" && status !== "finished" && status !== "progress") {
      summary[status as keyof Omit<CampaignRecipientSummary, "total" | "finished" | "progress">] +=
        1;
    }
  }
  summary.finished =
    summary.sent + summary.replied + summary.skipped + summary.failed + summary.cancelled;
  summary.progress = summary.total === 0 ? 0 : Math.round((summary.finished / summary.total) * 100);
  return summary;
}
