/** Formata a digitação sem alterar o valor numérico enviado ao servidor. */
export function formatBrlInput(value: string): string {
  const sanitized = value.replace(/[^\d,]/g, "");
  if (!sanitized) return "";

  const [integerRaw = "", decimalRaw = ""] = sanitized.split(",", 2);
  const integer = (integerRaw.replace(/^0+(?=\d)/, "") || "0").replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ".",
  );
  const decimal = decimalRaw.slice(0, 2);
  return sanitized.includes(",") ? `${integer},${decimal}` : integer;
}

export function brlInputToCents(value: string): number | null {
  if (!value.trim()) return null;
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}
