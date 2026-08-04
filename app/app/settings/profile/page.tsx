import { requireAuth } from "@/lib/auth/server";
import { ProfileForm } from "./_form";
import { BackNavigation } from "@/components/shell/BackNavigation";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requireAuth();
  const meta = (user as unknown as { full_name: string | null; avatar_url: string | null });
  // Read locale/timezone from raw user meta if present (loadAuthUser doesn't include them).
  // We pass safe defaults that the form re-syncs on submit.
  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header className="space-y-3">
        <BackNavigation fallbackHref="/app/settings" label="Voltar às configurações" />
        <h1 className="text-2xl font-semibold tracking-tight">Perfil</h1>
        <p className="text-sm text-muted-foreground">
          Informações pessoais. Email só pode ser trocado em breve.
        </p>
      </header>
      <ProfileForm
        email={user.email}
        initialFullName={meta.full_name}
        initialAvatarUrl={meta.avatar_url}
      />
    </div>
  );
}
