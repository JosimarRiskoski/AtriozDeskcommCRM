"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import { signUpFromInvite } from "@/app/actions/team/signUpFromInvite";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function InviteSignupForm({ token, email }: { token: string; email: string }) {
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center p-6">
      <form
        className="w-full space-y-4 rounded-lg border bg-card p-8"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await signUpFromInvite({ token, password, passwordConfirm });
            setMessage(
              result.ok
                ? `Confirme o e-mail enviado para ${result.email}; depois você entrará na empresa convidada.`
                : result.error,
            );
          });
        }}
      >
        <div>
          <h1 className="text-xl font-semibold">Criar acesso pelo convite</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Você criará somente seu acesso para {email}. Nenhuma empresa será criada.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Já possui uma conta?{" "}
          <Link
            className="font-medium text-foreground underline underline-offset-4"
            href={`/login?next=${encodeURIComponent(`/team/accept-invite/${token}`)}`}
          >
            Entre para aceitar o convite
          </Link>
          .
        </p>
        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password-confirm">Confirmar senha</Label>
          <Input
            id="password-confirm"
            type="password"
            autoComplete="new-password"
            value={passwordConfirm}
            onChange={(event) => setPasswordConfirm(event.target.value)}
          />
        </div>
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        <Button className="w-full" disabled={pending}>
          {pending ? "Criando acesso…" : "Criar meu acesso"}
        </Button>
      </form>
    </div>
  );
}
