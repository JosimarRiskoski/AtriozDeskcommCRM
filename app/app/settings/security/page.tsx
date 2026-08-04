import { requireAuth, isMfaEnrolled } from "@/lib/auth/server";
import { Card } from "@/components/ui/card";
import { SecurityClient } from "./_client";
import { BackNavigation } from "@/components/shell/BackNavigation";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  await requireAuth();
  const enrolled = await isMfaEnrolled();

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header className="space-y-3">
        <BackNavigation fallbackHref="/app/settings" label="Voltar às configurações" />
        <h1 className="text-2xl font-semibold tracking-tight">Segurança</h1>
        <p className="text-sm text-muted-foreground">MFA, recovery codes e sessões.</p>
      </header>

      <Card className="space-y-2 p-6">
        <h2 className="text-sm font-semibold">MFA (TOTP)</h2>
        <p className="text-sm">
          {enrolled ? (
            <span className="text-green-600">Ativado.</span>
          ) : (
            <span className="text-amber-600">Não ativado.</span>
          )}
        </p>
        {!enrolled && (
          <p className="text-xs text-muted-foreground">
            Faça login novamente para iniciar o enrolamento.
          </p>
        )}
      </Card>

      <SecurityClient mfaEnrolled={enrolled} />
    </div>
  );
}
