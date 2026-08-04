/**
 * Zod schemas for `/api/v1/contacts/*` endpoints (EPIC-05 waves 1, 2, 8).
 *
 * Contracts:
 *  - contactCreateSchema    → POST /api/v1/contacts
 *  - contactPatchSchema     → PATCH /api/v1/contacts/[id]
 *  - contactListQuerySchema → GET /api/v1/contacts (search/tag/source/cursor)
 *  - lgpdAnonymizeSchema    → POST /api/v1/lgpd/anonymize (irreversible)
 */
import { z } from "zod";
import { normalizePhoneBR } from "@/lib/phone/normalize";

const PHONE_REGEX = /^\+\d{8,15}$/;
const CPF_DIGITS = /^\d{11}$/;

/**
 * CPF check-digit validator (algoritmo oficial Receita Federal).
 * Rejeita repetidos (00000000000, 11111111111, ...) e dígitos verificadores inválidos.
 */
export function isValidCpf(raw: string): boolean {
  const s = raw.replace(/\D/g, "");
  if (!CPF_DIGITS.test(s) || /^(\d)\1{10}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(s[i]!, 10) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(s[9]!, 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(s[i]!, 10) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === parseInt(s[10]!, 10);
}

export const contactCreateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  display_name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  phone_number: z
    .string()
    .transform((value, ctx) => {
      const normalized = normalizePhoneBR(value);
      if (!normalized || !PHONE_REGEX.test(normalized)) {
        ctx.addIssue({
          code: "custom",
          message: "Telefone deve estar em formato E.164 (+5511999998888)",
        });
        return z.NEVER;
      }
      return normalized;
    })
    .optional(),
  cpf: z.string().refine(isValidCpf, "CPF inválido").optional(),
  birthdate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  tags: z.array(z.string()).optional(),
  company: z.string().trim().max(200).optional(),
  city: z.string().trim().max(120).optional(),
  state: z
    .string()
    .trim()
    .refine((value) => value === "" || /^[A-Za-z]{2}$/.test(value), "UF deve ter duas letras")
    .transform((value) => value.toUpperCase())
    .optional(),
  custom_fields: z
    .record(z.string().max(80), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
  source: z.string().min(1).default("manual"),
  source_metadata: z.record(z.string(), z.unknown()).optional(),
  consent: z.record(z.string(), z.unknown()).optional(),
});
export type ContactCreate = z.infer<typeof contactCreateSchema>;

export const contactPatchSchema = contactCreateSchema.partial();
export type ContactPatch = z.infer<typeof contactPatchSchema>;

export const contactListQuerySchema = z.object({
  search: z.string().optional(),
  tag: z.string().optional(),
  source: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ContactListQuery = z.infer<typeof contactListQuerySchema>;

export const lgpdAnonymizeSchema = z.object({
  contact_id: z.string().uuid(),
  justification: z.string().min(10).max(1000),
});
export type LgpdAnonymizeInput = z.infer<typeof lgpdAnonymizeSchema>;
