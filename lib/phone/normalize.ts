/** Normaliza telefones para E.164, incluindo a migracao brasileira do nono digito. */
export function normalizePhoneBR(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, "");

  if (!trimmed.startsWith("+")) {
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
    else if ((digits.length !== 12 && digits.length !== 13) || !digits.startsWith("55")) {
      return null;
    }
  }

  if (!/^\d{8,15}$/.test(digits) || /^0+$/.test(digits)) return null;

  // Brasil: +55 + DDD + celular antigo de 8 digitos. Numeros cujo assinante
  // comeca em 6-9 eram moveis; insere o nono digito. Fixos (2-5) permanecem.
  if (digits.startsWith("55") && digits.length === 12 && /^[6-9]/.test(digits[4] ?? "")) {
    digits = `${digits.slice(0, 4)}9${digits.slice(4)}`;
  }

  return `+${digits}`;
}

/** Formas que podem representar o mesmo celular BR antes/depois do nono dígito. */
export function phoneIdentityCandidates(raw: unknown): string[] {
  const canonical = normalizePhoneBR(raw);
  if (!canonical) return [];
  const candidates = [canonical];
  if (/^\+55[1-9]\d9[6-9]\d{7}$/.test(canonical)) {
    candidates.push(`${canonical.slice(0, 5)}${canonical.slice(6)}`);
  }
  return candidates;
}

/** Confirma equivalencia canonica; numeros apenas validos, mas diferentes, nunca casam. */
export function areSamePhoneIdentity(a: unknown, b: unknown): boolean {
  const left = normalizePhoneBR(a);
  const right = normalizePhoneBR(b);
  if (!left || !right) return false;
  return left === right;
}
