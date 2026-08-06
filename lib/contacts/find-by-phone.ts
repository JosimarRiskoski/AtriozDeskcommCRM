import type { SupabaseClient } from "@supabase/supabase-js";

import { phoneIdentityCandidates } from "@/lib/phone/normalize";

export type PhoneIdentityLookup =
  | { kind: "not_found" }
  | { kind: "found"; contactId: string }
  | { kind: "ambiguous"; contactIds: string[] };

/** Busca também a forma brasileira anterior ao nono dígito, sem escolher entre duplicados. */
export async function findActiveContactByPhone(
  supabase: SupabaseClient,
  organizationId: string,
  phone: string,
  preferredExactPhone?: string,
): Promise<PhoneIdentityLookup> {
  const candidates = phoneIdentityCandidates(phone);
  if (!candidates.length) return { kind: "not_found" };
  const { data, error } = await supabase
    .from("contacts")
    .select("id,phone_number")
    .eq("organization_id", organizationId)
    .in("phone_number", candidates)
    .is("is_merged_into", null)
    .limit(3);
  if (error) throw error;
  const ids = [...new Set((data ?? []).map((row) => String(row.id)))];
  if (ids.length === 0) return { kind: "not_found" };
  if (ids.length === 1) return { kind: "found", contactId: ids[0]! };

  // Durante a migração do nono dígito podem existir, temporariamente, dois
  // registros para o mesmo celular. Se o provedor informou uma representação
  // exata, ela é uma evidência determinística e segura para manter a mensagem
  // na conversa que já usa aquele mesmo número. Sem essa evidência continuamos
  // recusando a escolha ambígua.
  if (preferredExactPhone) {
    const exactIds = [
      ...new Set(
        (data ?? [])
          .filter((row) => String(row.phone_number ?? "") === preferredExactPhone)
          .map((row) => String(row.id)),
      ),
    ];
    if (exactIds.length === 1) return { kind: "found", contactId: exactIds[0]! };
  }
  return { kind: "ambiguous", contactIds: ids };
}
