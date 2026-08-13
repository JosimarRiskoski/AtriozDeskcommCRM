export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;

export function getGoogleCalendarConfig(): GoogleCalendarConfig | null {
  // O acesso por índice preserva a leitura em runtime. O acesso literal
  // process.env.NEXT_PUBLIC_APP_URL pode ser congelado pelo Next.js com o
  // placeholder usado durante o build da imagem genérica.
  const clientId = process.env["GOOGLE_CALENDAR_CLIENT_ID"]?.trim();
  const clientSecret = process.env["GOOGLE_CALENDAR_CLIENT_SECRET"]?.trim();
  const appUrl = process.env["NEXT_PUBLIC_APP_URL"]?.replace(/\/$/, "");
  if (!clientId || !clientSecret || !appUrl) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: `${appUrl}/api/v1/integrations/google-calendar/callback`,
  };
}
