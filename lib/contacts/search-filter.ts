import { hashCpf } from "@/lib/contacts/cpf";

/** Monta o filtro OR do PostgREST sem permitir que pontuação quebre a consulta. */
export function contactSearchOrFilter(raw: string): string {
  const s = raw.trim().replace(/[(),]/g, " ").replace(/\s+/g, " ").trim();
  const digits = s.replace(/\D/g, "");
  const orParts = [
    `name.ilike.%${s}%`,
    `display_name.ilike.%${s}%`,
    `email.ilike.%${s}%`,
    `phone_number.ilike.%${s}%`,
  ];
  if (digits.length === 11) orParts.push(`cpf_hash.eq.${hashCpf(digits)}`);
  return orParts.join(",");
}
