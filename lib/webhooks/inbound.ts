/**
 * Parsing do inbound de captação: field_map → lead normalizado + HMAC.
 * Sem I/O — puro, testável. A rota (webhooks/in/[token]) faz o resto.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizePhoneBR } from "@/lib/phone/normalize";

export { normalizePhoneBR } from "@/lib/phone/normalize";

export interface FieldMap {
  name?: string[];
  phone?: string[];
  email?: string[];
}

const DEFAULT_FIELD_MAP: Required<FieldMap> = {
  name: ["name", "nome", "full_name", "fullname"],
  phone: ["phone", "telefone", "whatsapp", "celular", "phone_number", "tel"],
  email: ["email", "e-mail", "mail"],
};

const SOURCE_TRACKING_FIELDS = new Set([
  "campaign_id",
  "campaign_name",
  "ad_id",
  "ad_name",
  "adset_id",
  "adset_name",
  "form_id",
  "platform",
  "fbclid",
  "fbc",
  "fbp",
  "pagina_origem",
  "landing_page",
]);

export interface MappedLead {
  name: string | null;
  phone: string | null;
  email: string | null;
  custom_fields: Record<string, string>;
  source_metadata: Record<string, string>;
}

export type MetaCapiConsent = {
  meta_capi: true;
  meta_capi_consent_at: string;
  meta_capi_consent_version: string | null;
};

/**
 * Consentimento de CAPI só é registrado quando o integrador o declara
 * explicitamente como verdadeiro. Ausência ou valor inválido nunca viram
 * consentimento por inferência.
 */
export function readMetaCapiConsent(payload: Record<string, unknown>): MetaCapiConsent | null {
  const value = payload.meta_capi_consent;
  if (value !== true && value !== "true" && value !== "1" && value !== 1) return null;

  const declaredAt =
    typeof payload.meta_capi_consent_at === "string"
      ? new Date(payload.meta_capi_consent_at)
      : null;
  const meta_capi_consent_at =
    declaredAt && !Number.isNaN(declaredAt.getTime())
      ? declaredAt.toISOString()
      : new Date().toISOString();
  const version =
    typeof payload.meta_capi_consent_version === "string"
      ? payload.meta_capi_consent_version.trim().slice(0, 100) || null
      : null;

  return { meta_capi: true, meta_capi_consent_at, meta_capi_consent_version: version };
}

export function mergeMetaCapiConsent(
  existing: Record<string, unknown> | null | undefined,
  inbound: MetaCapiConsent | null,
): Record<string, unknown> {
  if (!inbound) return { ...(existing ?? {}) };
  return { ...(existing ?? {}), ...inbound };
}

/**
 * Acrescenta a atribuicao recebida sem apagar dados de origem já conhecidos.
 * Serve tanto para contatos quanto para oportunidades que o webhook reutiliza.
 */
export function mergeInboundSourceMetadata(
  existing: Record<string, unknown> | null | undefined,
  inbound: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(existing ?? {}), ...inbound };
}

function firstMatch(
  payload: Record<string, unknown>,
  aliases: string[],
): { key: string; value: string } | null {
  const lowered = new Map(Object.keys(payload).map((k) => [k.toLowerCase(), k]));
  for (const alias of aliases) {
    const key = lowered.get(alias.toLowerCase());
    if (key !== undefined) {
      const v = payload[key];
      if (typeof v === "string" && v.trim()) return { key, value: v.trim() };
    }
  }
  return null;
}

export function mapInboundPayload(
  payload: Record<string, unknown>,
  fieldMap: FieldMap = {},
): MappedLead {
  const map: Required<FieldMap> = {
    name: [...(fieldMap.name ?? []), ...DEFAULT_FIELD_MAP.name],
    phone: [...(fieldMap.phone ?? []), ...DEFAULT_FIELD_MAP.phone],
    email: [...(fieldMap.email ?? []), ...DEFAULT_FIELD_MAP.email],
  };

  const nameHit = firstMatch(payload, map.name);
  const phoneHit = firstMatch(payload, map.phone);
  const emailHit = firstMatch(payload, map.email);
  const consumed = new Set([nameHit?.key, phoneHit?.key, emailHit?.key].filter(Boolean));

  const custom_fields: Record<string, string> = {};
  const source_metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (consumed.has(key)) continue;
    const str =
      typeof value === "string"
        ? value
        : typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : null;
    if (str === null) continue; // objetos/arrays aninhados: descartados no v1
    if (key.toLowerCase().startsWith("utm_") || SOURCE_TRACKING_FIELDS.has(key.toLowerCase()))
      source_metadata[key.toLowerCase()] = str;
    else custom_fields[key] = str;
  }

  return {
    name: nameHit?.value ?? null,
    phone: normalizePhoneBR(phoneHit?.value),
    email: emailHit?.value ?? null,
    custom_fields,
    source_metadata,
  };
}

/** HMAC SHA-256 hex do raw body. Header: X-Deskcomm-Signature. */
export function verifyInboundSignature(
  rawBody: string,
  header: string | null,
  secret: string,
): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(header, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isExternalAutomationActive(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== "string") return false;
  return ["1", "active", "running", "ativo", "executando"].includes(value.trim().toLowerCase());
}
