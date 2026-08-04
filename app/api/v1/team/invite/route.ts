/**
 * POST /api/v1/team/invite — bulk-invite up to 20 emails.
 *
 * Pragmatic MVP: invitations are stateless HMAC tokens (no team_invites table).
 * If a user with that email already has an active membership in the org, we
 * skip with reason `already_member`. Otherwise we sign a 24h token containing
 * a fresh invite_id (uuid) + email + org_id + role and email the link.
 *
 * Membership row is created at /accept-invite time (Server Action) — that's
 * also when audit emits `member.accepted`. Here we audit `member.invited`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { ok, fail } from "@/lib/api/wrappers";
import { ApiError } from "@/lib/api/types";
import { audit, isServiceRoleConfigured } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteMemberSchema, validateRequest } from "@/lib/schemas";
import { signInviteToken, INVITE_TTL_SECONDS } from "@/lib/auth/invite-token";
import { buildInviteEmail } from "@/lib/email/templates/invite";
import { sendEmail } from "@/lib/email/resend";

export const dynamic = "force-dynamic";

const actionSchema = z.object({
  invite_id: z.string().uuid(),
  action: z.enum(["resend", "cancel"]),
});

interface SentItem {
  email: string;
  invite_id: string;
  expires_at: string;
  email_dispatched: boolean;
  accept_url: string;
}
interface FailedItem {
  email: string;
  reason: string;
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("team_invitations")
    .select("id,email,role,status,expires_at,email_dispatched,last_error,last_sent_at,accepted_at,cancelled_at,created_at")
    .eq("organization_id", authz.org.orgId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  const now = Date.now();
  return ok(
    (data ?? []).map((invite) => ({
      ...invite,
      display_status:
        invite.status === "pending" && Date.parse(invite.expires_at) <= now
          ? "expired"
          : invite.status,
    })),
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  let input;
  try {
    input = await validateRequest(inviteMemberSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  const sent: SentItem[] = [];
  const failed: FailedItem[] = [];

  const admin = isServiceRoleConfigured() ? createAdminClient() : null;
  if (!admin) {
    return fail("service_unavailable", "O servidor ainda não está pronto para registrar convites.", 503, { requestId });
  }
  // env.* parseia process.env em runtime → funciona na imagem genérica self-host
  // (não fica queimado no bundle como process.env.NEXT_PUBLIC_APP_URL direto).
  const baseUrl = env.NEXT_PUBLIC_APP_URL;
  const inviterName = authUser.full_name ?? authUser.email ?? "Um colega";

  // Emails com membership ATIVA na org — para pular o reconvite de quem já é membro.
  // O schema `auth` NÃO é acessível via PostgREST (erro "Invalid schema: auth"), então
  // resolvemos email↔usuário pela GoTrue admin API (getUserById) — mesmo padrão de
  // app/api/v1/team/route.ts. N pequeno (poucos membros por org no perfil BPO).
  const memberEmails = new Set<string>();
  if (admin) {
    const { data: members } = await admin
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", activeOrg.orgId)
      .is("revoked_at", null);
    for (const m of members ?? []) {
      const { data: u } = await admin.auth.admin.getUserById(m.user_id as string);
      const memberEmail = u?.user?.email?.trim().toLowerCase();
      if (memberEmail) memberEmails.add(memberEmail);
    }
  }

  for (const inv of input.invitations) {
    const email = inv.email.trim().toLowerCase();

    // já é membro ativo → pula (não reenvia convite)
    if (memberEmails.has(email)) {
      failed.push({ email, reason: "already_member" });
      continue;
    }

    const { data: previousInvite } = await admin
      .from("team_invitations")
      .select("id,status,expires_at")
      .eq("organization_id", activeOrg.orgId)
      .ilike("email", email)
      .eq("status", "pending")
      .maybeSingle();
    if (previousInvite && Date.parse(previousInvite.expires_at) > Date.now()) {
      failed.push({ email, reason: "already_pending" });
      continue;
    }
    if (previousInvite) {
      await admin
        .from("team_invitations")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", previousInvite.id)
        .eq("organization_id", activeOrg.orgId);
    }

    const inviteId = randomUUID();
    const exp = Math.floor(Date.now() / 1000) + INVITE_TTL_SECONDS;
    const token = signInviteToken({
      invite_id: inviteId,
      email,
      organization_id: activeOrg.orgId,
      role: inv.role,
      exp,
    });
    const acceptUrl = `${baseUrl.replace(/\/$/, "")}/team/accept-invite/${token}`;
    const expiresAt = new Date(exp * 1000);

    const { subject, html, text } = buildInviteEmail({
      inviterName,
      orgName: activeOrg.name,
      acceptUrl,
      role: inv.role,
      expiresAt,
    });

    const result = await sendEmail({
      to: email,
      subject,
      html,
      text,
      tags: [
        { name: "kind", value: "team_invite" },
        { name: "org", value: activeOrg.orgId },
      ],
    });

    {
      const { error: persistError } = await admin.from("team_invitations").insert({
        id: inviteId,
        organization_id: activeOrg.orgId,
        email,
        role: inv.role,
        can_receive_human_cases: inv.can_receive_human_cases,
        status: result.ok ? "pending" : "failed",
        invited_by: authUser.id,
        expires_at: expiresAt.toISOString(),
        email_dispatched: result.ok,
        provider_message_id: result.id ?? null,
        last_error: result.ok ? null : (result.details ?? result.error ?? "send_failed"),
        last_sent_at: new Date().toISOString(),
      });
      if (persistError) {
        failed.push({ email, reason: persistError.code === "23505" ? "already_pending" : "invite_persist_failed" });
        continue;
      }
    }

    if (!result.ok) {
      await admin.rpc("fn_emit_notification", {
        p_org: activeOrg.orgId,
        p_category: "team_invite_failed",
        p_severity: "warning",
        p_title: "Convite de equipe não foi enviado",
        p_body: `O convite para ${email} foi criado, mas o e-mail falhou. Copie o link de acesso e verifique o Resend.`,
        p_action_url: "/app/team/invite",
        p_resource_type: "membership_invite",
        p_resource_id: inviteId,
        p_dedupe_key: `team-invite-failed-${inviteId}`,
        p_target_user: authUser.id,
        p_metadata: { error: result.error ?? "send_failed" },
      });
    }

    sent.push({
      email,
      invite_id: inviteId,
      expires_at: expiresAt.toISOString(),
      email_dispatched: result.ok,
      accept_url: acceptUrl,
    });

    await audit({
      action: "member.invited",
      actorUserId: authUser.id,
      organizationId: activeOrg.orgId,
      resourceType: "membership",
      resourceId: inviteId,
      requestId,
      metadata: {
        email,
        role: inv.role,
        email_dispatched: result.ok,
        email_error: result.ok ? null : (result.error ?? null),
      },
    });
  }

  return ok({ sent, failed }, { status: 201, requestId });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Ação de convite inválida.", 422, { requestId });

  const admin = createAdminClient();
  const { data: invite, error } = await admin
    .from("team_invitations")
    .select("id,email,role,status")
    .eq("organization_id", authz.org.orgId)
    .eq("id", parsed.data.invite_id)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!invite) return fail("not_found", "Convite não encontrado.", 404, { requestId });
  if (invite.status === "accepted") return fail("conflict", "Este convite já foi aceito.", 409, { requestId });

  if (parsed.data.action === "cancel") {
    const { error: cancelError } = await admin
      .from("team_invitations")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", invite.id)
      .eq("organization_id", authz.org.orgId);
    if (cancelError) return fail("internal_error", cancelError.message, 500, { requestId });
    await audit({
      action: "member.invited",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "membership_invite",
      resourceId: invite.id,
      requestId,
      metadata: { event: "cancelled", email: invite.email },
    });
    return ok({ invite_id: invite.id, status: "cancelled" }, { requestId });
  }

  const exp = Math.floor(Date.now() / 1000) + INVITE_TTL_SECONDS;
  const token = signInviteToken({
    invite_id: invite.id,
    email: invite.email,
    organization_id: authz.org.orgId,
    role: invite.role,
    exp,
  });
  const expiresAt = new Date(exp * 1000);
  const acceptUrl = `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/team/accept-invite/${token}`;
  const { subject, html, text } = buildInviteEmail({
    inviterName: authz.user.full_name ?? authz.user.email ?? "Um colega",
    orgName: authz.org.name,
    acceptUrl,
    role: invite.role,
    expiresAt,
  });
  const result = await sendEmail({
    to: invite.email,
    subject,
    html,
    text,
    tags: [
      { name: "kind", value: "team_invite" },
      { name: "org", value: authz.org.orgId },
    ],
  });
  const { error: updateError } = await admin
    .from("team_invitations")
    .update({
      status: result.ok ? "pending" : "failed",
      expires_at: expiresAt.toISOString(),
      email_dispatched: result.ok,
      provider_message_id: result.id ?? null,
      last_error: result.ok ? null : (result.details ?? result.error ?? "send_failed"),
      last_sent_at: new Date().toISOString(),
      cancelled_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invite.id)
    .eq("organization_id", authz.org.orgId);
  if (updateError) return fail("internal_error", updateError.message, 500, { requestId });
  return ok({
    invite_id: invite.id,
    status: result.ok ? "pending" : "failed",
    email_dispatched: result.ok,
    accept_url: result.ok ? undefined : acceptUrl,
  }, { requestId });
}
