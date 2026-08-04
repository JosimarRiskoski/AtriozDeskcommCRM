const SOURCE_LABELS: Record<string, string> = {
  manual: "Cadastro manual",
  whatsapp: "WhatsApp",
  campaign: "Campanha",
  campaign_csv: "Campanha por planilha",
  cold_call_manual: "Cold call manual",
  cold_call_ai: "Cold call com IA",
  paid_traffic: "Tráfego pago",
  webhook: "Webhook",
  "3c": "3C",
};

export function contactSourceLabel(source: string | null | undefined): string {
  if (!source) return "Origem não informada";
  return SOURCE_LABELS[source] ?? source.replaceAll("_", " ");
}
