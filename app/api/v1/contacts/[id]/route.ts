/**
 * GET   /api/v1/contacts/[id] — fetch single (handler em ../_handler.ts)
 * PATCH /api/v1/contacts/[id] — update (handler em ../_handler.ts)
 *
 * Thin wrapper: auth + Zod + ok/fail. Decrypt CPF + LGPD irreversibility no handler.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { contactPatchSchema, validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";

import { getContactHandler, patchContactHandler } from "../_handler";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }

  const authUser = await loadAuthUser();
  const activeOrg = authUser ? await resolveActiveOrg(authUser) : null;
  if (!activeOrg) {
    return fail("no_active_org", "No active organization.", 403, { requestId });
  }

  const decryptPurpose = req.headers.get("x-decrypt-purpose");

  try {
    const result = await getContactHandler(
      supabase,
      {
        organization_id: activeOrg.orgId,
        actor: { type: "user", id: user.id },
        requestId,
      },
      { contactId: id, decryptPurpose },
    );
    return ok(result, { requestId });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { requestId });
    }
    throw err;
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const supabase = await createClient();
  // spec 13 §4: escrita é agent+ (viewer é read-only).
  const authz = await requireRole("agent", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const user = authz.user;
  const activeOrg = authz.org;

  let input;
  try {
    input = await validateRequest(contactPatchSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  try {
    const contact = await patchContactHandler(
      supabase,
      {
        organization_id: activeOrg.orgId,
        actor: { type: "user", id: user.id },
        requestId,
      },
      id,
      input,
    );
    return ok(contact, { requestId });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { requestId });
    }
    throw err;
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("manager", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;

  const { user, org: activeOrg } = authz;
  const supabase = await createClient();
  const { data: contact, error: contactErr } = await supabase
    .from("contacts")
    .select("id,name,display_name,email,phone_number,is_anonymized")
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (contactErr) return fail("internal_error", contactErr.message, 500, { requestId });
  if (!contact) return fail("not_found", "Contato nÃ£o encontrado.", 404, { requestId });

  const [
    { count: conversationCount, error: conversationErr },
    { count: messageCount, error: messageErr },
  ] = await Promise.all([
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", activeOrg.orgId)
      .eq("contact_id", id),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", activeOrg.orgId)
      .eq("contact_id", id),
  ]);

  if (conversationErr || messageErr) {
    return fail(
      "internal_error",
      conversationErr?.message ?? messageErr?.message ?? "contact_dependency_check_failed",
      500,
      { requestId },
    );
  }
  if ((conversationCount ?? 0) > 0 || (messageCount ?? 0) > 0) {
    return fail(
      "contact_has_history",
      "Este contato possui conversas ou mensagens. Para preservar o histÃ³rico, use Anonimizar contato na aba LGPD.",
      409,
      {
        requestId,
        details: { conversations: conversationCount ?? 0, messages: messageCount ?? 0 },
      },
    );
  }

  const { data: deleted, error: deleteErr } = await supabase
    .from("contacts")
    .delete()
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .select("id")
    .maybeSingle();
  if (deleteErr) return fail("internal_error", deleteErr.message, 500, { requestId });
  if (!deleted) return fail("not_found", "Contato nÃ£o encontrado.", 404, { requestId });

  void audit({
    action: "contact.deleted",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "contact",
    resourceId: id,
    requestId,
    metadata: {
      display_name: contact.display_name ?? contact.name ?? null,
      had_email: Boolean(contact.email),
      had_phone: Boolean(contact.phone_number),
      was_anonymized: contact.is_anonymized,
    },
  });

  return ok({ id, deleted: true }, { requestId });
}
