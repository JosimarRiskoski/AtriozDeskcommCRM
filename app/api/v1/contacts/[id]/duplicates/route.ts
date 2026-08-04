import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { areSamePhoneIdentity, phoneIdentityCandidates } from "@/lib/phone/normalize";
import { createClient } from "@/lib/supabase/server";

const mergeSchema = z.object({
  duplicate_contact_id: z.string().uuid(),
  primary_contact_id: z.string().uuid(),
});

const MERGE_ERRORS: Record<string, string> = {
  merge_overlap_conversations:
    "Os dois contatos têm conversa na mesma conexão. Revise o histórico antes de mesclar.",
  merge_overlap_followups:
    "Os dois contatos participam da mesma cadência ativa. Cancele uma delas antes de mesclar.",
  merge_overlap_agent_state:
    "Os dois contatos possuem estado ativo do agente. Resolva esse estado antes de mesclar.",
  merge_anonymized_contact: "Contatos anonimizados não podem ser mesclados.",
  merge_already_resolved: "Um dos contatos já foi mesclado anteriormente.",
  merge_phone_identity_mismatch:
    "Os telefones não representam o mesmo celular antes e depois do nono dígito.",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;
  const authz = await requireRole("manager", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const supabase = await createClient();
  const { data: contact } = await supabase
    .from("contacts")
    .select("id,phone_number")
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .is("is_merged_into", null)
    .maybeSingle();
  if (!contact) return fail("not_found", "Contato não encontrado.", 404, { requestId });

  const aliases = phoneIdentityCandidates(contact.phone_number);
  if (aliases.length < 2) return ok([], { requestId });
  const { data, error } = await supabase
    .from("contacts")
    .select("id,name,display_name,email,phone_number,source,created_at,last_activity_at")
    .eq("organization_id", authz.org.orgId)
    .in("phone_number", aliases)
    .neq("id", id)
    .is("is_merged_into", null)
    .order("created_at", { ascending: true });
  if (error)
    return fail("internal_error", "Não foi possível procurar duplicidades.", 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;
  const authz = await requireRole("manager", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const parsed = mergeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return fail("validation_failed", "Escolha os contatos da mesclagem.", 422, { requestId });
  const { duplicate_contact_id: duplicateId, primary_contact_id: primaryId } = parsed.data;
  if (!new Set([primaryId, duplicateId]).has(id) || primaryId === duplicateId)
    return fail("validation_failed", "A seleção da mesclagem é inválida.", 422, { requestId });

  const supabase = await createClient();
  const { data: pair } = await supabase
    .from("contacts")
    .select("id,organization_id,phone_number")
    .eq("organization_id", authz.org.orgId)
    .in("id", [primaryId, duplicateId])
    .is("is_merged_into", null);
  if (pair?.length !== 2)
    return fail("not_found", "Um dos contatos não está mais disponível.", 404, { requestId });
  if (!areSamePhoneIdentity(pair[0]?.phone_number, pair[1]?.phone_number))
    return fail(
      "identity_mismatch",
      "Os telefones não formam um par seguro antes/depois do nono dígito.",
      409,
      { requestId },
    );

  const { error } = await supabase.rpc(
    "fn_merge_contacts_safe" as never,
    {
      p_primary: primaryId,
      p_duplicate: duplicateId,
      p_queue: null,
    } as never,
  );
  if (error) {
    const code = Object.keys(MERGE_ERRORS).find((key) => error.message.includes(key));
    return fail(
      "merge_blocked",
      (code ? MERGE_ERRORS[code] : null) ?? "A mesclagem foi bloqueada para preservar os dados.",
      409,
      { requestId, details: { technical_reason: error.message } },
    );
  }

  await audit({
    action: "contact.merged",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "contact",
    resourceId: primaryId,
    requestId,
    metadata: { merged_contact_id: duplicateId, reason: "br_ninth_digit_review" },
  });
  return ok({ primary_contact_id: primaryId, merged_contact_id: duplicateId }, { requestId });
}
