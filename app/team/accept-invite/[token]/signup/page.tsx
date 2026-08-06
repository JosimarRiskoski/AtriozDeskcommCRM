import { verifyInviteToken } from "@/lib/auth/invite-token";

import { InviteSignupForm } from "./InviteSignupForm";

export const dynamic = "force-dynamic";

export default async function InviteSignupPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = verifyInviteToken(token);

  if (!invite) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md items-center p-6">
        <div className="w-full rounded-lg border bg-card p-8">
          <h1 className="text-xl font-semibold">Convite inválido ou expirado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Peça um novo convite ao administrador da empresa.
          </p>
        </div>
      </div>
    );
  }

  return <InviteSignupForm token={token} email={invite.email} />;
}
