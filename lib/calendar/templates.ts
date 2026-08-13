export interface ReminderTemplateContext {
  contactName?: string | null;
  startsAt: string;
  timezone: string;
  location?: string | null;
  meetUrl?: string | null;
}

function parts(value: string, timezone: string): { date: string; time: string } {
  const date = new Date(value);
  return {
    date: new Intl.DateTimeFormat("pt-BR", {
      timeZone: timezone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date),
    time: new Intl.DateTimeFormat("pt-BR", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date),
  };
}

export function renderReminderTemplate(template: string, context: ReminderTemplateContext): string {
  const formatted = parts(context.startsAt, context.timezone);
  const localOrLink = context.meetUrl
    ? `Acesse: ${context.meetUrl}`
    : context.location
      ? `Local: ${context.location}`
      : "";
  return template
    .replaceAll("{{nome}}", context.contactName?.trim() || "")
    .replaceAll("{{data}}", formatted.date)
    .replaceAll("{{hora}}", formatted.time)
    .replaceAll("{{local}}", context.location?.trim() || "")
    .replaceAll("{{link_meet}}", context.meetUrl?.trim() || "")
    .replaceAll("{{local_ou_link}}", localOrLink)
    .replace(/\s{2,}/g, " ")
    .trim();
}
