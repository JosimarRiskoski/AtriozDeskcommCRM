import { requireAuth } from "@/lib/auth/server";
import { resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { NotificationsClient } from "./NotificationsClient";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  const canTest = user.is_platform_admin || Boolean(org && ROLE_RANK[org.role] >= ROLE_RANK.admin);
  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Notificações</h1>
        <p className="text-sm text-muted-foreground">Canais e categorias.</p>
      </header>

      <NotificationsClient canTest={canTest} />
    </div>
  );
}
