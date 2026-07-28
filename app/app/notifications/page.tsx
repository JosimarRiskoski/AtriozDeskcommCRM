import { requireAuth } from "@/lib/auth/server";
import { NotificationsInbox } from "./NotificationsInbox";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  await requireAuth();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Notificações</h1>
        <p className="text-sm text-muted-foreground">O que aconteceu, por que importa e para onde você deve ir.</p>
      </header>
      <NotificationsInbox />
    </div>
  );
}

