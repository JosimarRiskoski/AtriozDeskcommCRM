import Link from "next/link";

import { GoogleCalendarSettings } from "@/components/calendar/GoogleCalendarSettings";

export const dynamic = "force-dynamic";

export default function GoogleCalendarSettingsPage() {
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header>
        <Link href="/app/settings" className="text-sm text-muted-foreground hover:text-foreground">← Voltar às configurações</Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Google Agenda</h1>
        <p className="text-sm text-muted-foreground">Eventos, Google Meet e lembretes fixos pelo WhatsApp.</p>
      </header>
      <GoogleCalendarSettings />
    </div>
  );
}
