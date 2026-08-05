"use server";

import { headers } from "next/headers";

import { verifyInviteToken } from "@/lib/auth/invite-token";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export async function signUpFromInvite(input: {
  token: string;
  password: string;
  passwordConfirm: string;
}) {
  const invite = verifyInviteToken(input.token);
  if (!invite) return { ok: false as const, error: "Convite inválido ou expirado." };
  if (input.password.length < 8)
    return { ok: false as const, error: "A senha deve ter pelo menos 8 caracteres." };
  if (input.password !== input.passwordConfirm)
    return { ok: false as const, error: "As senhas não coincidem." };

  const origin = (await headers()).get("origin") ?? env.NEXT_PUBLIC_APP_URL;
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: invite.email,
    password: input.password,
    options: {
      emailRedirectTo: `${origin}/auth/confirm?invite=${encodeURIComponent(input.token)}`,
      data: { invited: true },
    },
  });
  if (error)
    return { ok: false as const, error: "Não foi possível criar a conta. Tente novamente." };
  return { ok: true as const, email: invite.email };
}
