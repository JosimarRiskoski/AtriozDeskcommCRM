"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { loginSchema, type LoginInput } from "@/lib/auth/schemas";
import { audit, hashEmail } from "@/lib/audit";
import { safeNextPath } from "@/lib/auth/next-path";
import { classifyLoginError } from "@/lib/auth/login-error";
import { ensureTenantForUser } from "@/lib/auth/provision";

export type SignInResult = {
  ok: false;
  error: "invalid_credentials" | "rate_limited" | "validation_error" | "mfa_required" | "service_unavailable";
  details?: Record<string, unknown>;
  challengeId?: string;
};

/**
 * Sign in with password.
 *
 * On success: redirects server-side to `next` (or /app/inbox / /onboarding/mfa).
 * The redirect ensures Set-Cookie headers from supabase.auth propagate before
 * middleware re-evaluates the session — fixes Next 15 Server Action cookie
 * propagation race.
 *
 * On failure: returns an error discriminator. Caller renders inline message.
 */
export async function signInWithPassword(input: LoginInput, next?: string): Promise<SignInResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "validation_error",
      details: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const hdrs = await headers();
  const requestId = hdrs.get("x-request-id");
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = hdrs.get("user-agent") ?? null;

  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    await audit({
      action: "auth.login_failed",
      metadata: {
        email_hash: hashEmail(parsed.data.email),
        reason: error?.message ?? "unknown",
      },
      requestId,
      ip,
      userAgent,
    });
    return { ok: false, error: classifyLoginError(error) };
  }

  // MFA gating — if the user has any verified TOTP factor enrolled, they must
  // complete the challenge in /login/mfa before reaching the app.
  const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();
  if (factorsError || !factorsData) {
    return { ok: false, error: "service_unavailable" };
  }
  const verifiedTotp = factorsData?.totp?.find((f) => f.status === "verified");
  if (verifiedTotp) {
    return { ok: false, error: "mfa_required", challengeId: verifiedTotp.id };
  }

  // A confirmação pode ter criado a sessão e falhado antes de gravar a
  // membership. Retomamos somente o cadastro comum identificado por org_name;
  // contas de convite nunca criam empresa por este caminho.
  if (data.user.user_metadata?.invited !== true && typeof data.user.user_metadata?.org_name === "string") {
    let resumedProvisioning = false;
    let provisionedOrganizationId: string | undefined;
    try {
      const provision = await ensureTenantForUser(data.user);
      resumedProvisioning = provision.provisioned;
      provisionedOrganizationId = provision.organizationId;
    } catch (provisionError) {
      await audit({
        action: "auth.signup_provision_failed",
        actorUserId: data.user.id,
        metadata: { reason: provisionError instanceof Error ? provisionError.message : String(provisionError) },
        requestId,
        ip,
        userAgent,
      });
      return { ok: false, error: "service_unavailable" };
    }
    if (resumedProvisioning) {
      void audit({
        action: "auth.signup_provision_resumed",
        actorUserId: data.user.id,
        organizationId: provisionedOrganizationId ?? null,
        metadata: {},
        requestId,
        ip,
        userAgent,
      });
      redirect("/onboarding/welcome");
    }
  }

  // Auditoria e importante, mas nao pode atrasar a entrega do cookie de sessao
  // nem prender a pessoa em "Entrando..." quando o banco estiver sob carga.
  // `audit` trata a propria falha; nao ha dado de negocio a reverter aqui.
  void audit({
    action: "auth.login_success",
    actorUserId: data.user.id,
    metadata: {},
    requestId,
    ip,
    userAgent,
  });

  // Server-side redirect ensures fresh session cookie is sent to browser.
  redirect(safeNextPath(next));
}
