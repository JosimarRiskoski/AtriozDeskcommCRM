export interface CampaignTemplateRecipient {
  recipient_name: string | null;
  phone_normalized: string;
}

export function renderCampaignText(template: string, claim: CampaignTemplateRecipient): string {
  const firstName = claim.recipient_name?.trim().split(/\s+/)[0] || "";
  return template
    .replaceAll("{{primeiro_nome}}", firstName)
    .replaceAll("{{nome}}", claim.recipient_name?.trim() || "")
    .replaceAll("{{telefone}}", claim.phone_normalized);
}

/** A segunda mensagem só pode sair depois da primeira e uma única vez. */
export function campaignMessagePart(input: {
  text_sent_at: string | null;
  followup_text_template: string | null;
  followup_sent_at: string | null;
}): "text" | "followup" {
  return input.text_sent_at && input.followup_text_template && !input.followup_sent_at
    ? "followup"
    : "text";
}

export function isWithinBusinessHours(now: Date, timezone: string, start: string, end: string): boolean {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const hhmm = `${parts.find((p) => p.type === "hour")?.value}:${parts.find((p) => p.type === "minute")?.value}`;
  return hhmm >= start.slice(0, 5) && hhmm < end.slice(0, 5);
}
