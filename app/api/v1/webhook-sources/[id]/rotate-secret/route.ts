import { randomBytes, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

const bodySchema = z.object({
  overlap_hours: z.number().int().min(0).max(168).default(24),
  revoke: z.boolean().default(false),
});

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "webhook_sources" });
  if (!authz.ok) return authz.response;
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return fail("validation_failed", "Período de sobreposição inválido.", 422, { requestId });
  const admin = createAdminClient();
  const { data: source } = await admin
    .from("webhook_sources")
    .select("id,provider_type,secret_encrypted")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (!source) return fail("not_found", "Integração não encontrada.", 404, { requestId });
  if (source.provider_type !== "3c")
    return fail("validation_failed", "A rotação guiada é exclusiva da integração 3C.", 422, {
      requestId,
    });
  if (parsed.data.revoke) {
    await admin
      .from("webhook_sources")
      .update({
        secret_encrypted: null,
        previous_secret_encrypted: null,
        token_overlap_until: null,
        automation_enabled: false,
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("organization_id", authz.org.orgId);
    await audit({
      action: "webhook.source_updated",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "webhook_source",
      resourceId: id,
      requestId,
      metadata: { credential_revoked: true, source_paused: true },
    });
    return ok({ revoked: true, source_paused: true }, { requestId });
  }
  const plaintext = randomBytes(32).toString("base64url");
  const encrypted = await encryptWebhookSecret(admin, plaintext);
  if (!encrypted)
    return fail("encryption_unavailable", "A cifra de credenciais não está configurada.", 422, {
      requestId,
    });
  const overlapUntil =
    parsed.data.overlap_hours > 0
      ? new Date(Date.now() + parsed.data.overlap_hours * 3600_000).toISOString()
      : null;
  const { error } = await admin
    .from("webhook_sources")
    .update({
      previous_secret_encrypted: source.secret_encrypted,
      secret_encrypted: encrypted,
      token_overlap_until: overlapUntil,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", authz.org.orgId);
  if (error)
    return fail("internal_error", "Não foi possível rotacionar a credencial.", 500, { requestId });
  await audit({
    action: "webhook.source_updated",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "webhook_source",
    resourceId: id,
    requestId,
    metadata: { credential_rotated: true, overlap_hours: parsed.data.overlap_hours },
  });
  return ok(
    {
      secret: plaintext,
      overlap_until: overlapUntil,
      warning: "Copie agora. Esta credencial não será exibida novamente.",
    },
    { requestId },
  );
}
