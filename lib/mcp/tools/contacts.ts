/**
 * MCP read tools sobre /api/v1/contacts (Spec 11 §3.1).
 *
 * Wrappa os handlers REST extraidos na wave 2 (S-13.02). O MCP server core
 * injeta `ctx.supabase` (admin client + service-role) e `ctx.organizationId`
 * — handlers ja aplicam `.eq('organization_id', ctx.organization_id)` em
 * defesa-em-profundidade pos wave 3 (RLS continua valida quando ctx vem
 * de cookie).
 */
import { z } from "zod";

import {
  listContactsHandler,
  getContactHandler,
  patchContactHandler,
} from "@/app/api/v1/contacts/_handler";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import type { McpContext, McpToolDefinition } from "../types";

type ContactAccessMode = "none" | "read" | "write";

function contactAccess(ctx: McpContext, field: string): ContactAccessMode {
  if (ctx.actor.type !== "ai_agent" || !ctx.contactFieldAccess) return "write";
  return ctx.contactFieldAccess[field] ?? "none";
}

function canRead(ctx: McpContext, field: string): boolean {
  return contactAccess(ctx, field) !== "none";
}

function assertCanWrite(ctx: McpContext, fields: readonly string[]): void {
  const denied = fields.filter((field) => contactAccess(ctx, field) !== "write");
  if (denied.length > 0) throw new Error(`contact_field_write_denied:${denied.join(",")}`);
}

const searchInputShape = {
  query: z.string().min(1).max(200).describe("Termo de busca (nome, email ou telefone)."),
  limit: z.number().int().min(1).max(50).default(10),
  cursor: z.string().optional(),
};

export const crmSearchContacts: McpToolDefinition<typeof searchInputShape> = {
  name: "crm_search_contacts",
  description:
    "Busca contatos do CRM por nome, email ou telefone. Retorna ate 50 matches com id, nome, telefone, email, tags e timestamps. Sempre escopado a organization do token.",
  inputSchema: searchInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const result = await listContactsHandler(
      ctx.supabase,
      {
        organization_id: ctx.organizationId,
        actor: ctx.actor,
        requestId: ctx.requestId,
      },
      {
        search: input.query,
        limit: input.limit,
        cursor: input.cursor,
        include_anonymized: false,
      },
    );
    return {
      contacts: result.contacts.map((c) => ({
        id: c.id,
        ...(canRead(ctx, "name") ? { name: c.name ?? c.display_name } : {}),
        ...(canRead(ctx, "phone_number") ? { phone: c.phone_number } : {}),
        ...(canRead(ctx, "email") ? { email: c.email } : {}),
        ...(canRead(ctx, "company") ? { company: c.company } : {}),
        ...(canRead(ctx, "city") ? { city: c.city } : {}),
        ...(canRead(ctx, "state") ? { state: c.state } : {}),
        ...(canRead(ctx, "tags") ? { tags: c.tags ?? [] } : {}),
        is_blocked: c.is_blocked,
        is_anonymized: c.is_anonymized,
        created_at: c.created_at,
        last_activity_at: c.last_activity_at,
      })),
      cursor: result.cursor,
      has_more: result.has_more,
    };
  },
};

const getInputShape = {
  contact_id: z.string().uuid().describe("UUID do contato."),
};

export const crmGetContact: McpToolDefinition<typeof getInputShape> = {
  name: "crm_get_contact",
  description:
    "Retorna detalhes de um contato pelo UUID. Inclui tags, consent, source. CPF nunca retornado em plaintext via MCP (sempre mascarado).",
  inputSchema: getInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const contact = await getContactHandler(
      ctx.supabase,
      {
        organization_id: ctx.organizationId,
        actor: ctx.actor,
        requestId: ctx.requestId,
      },
      { contactId: input.contact_id, decryptPurpose: null },
    );
    return {
      id: contact.id,
      ...(canRead(ctx, "name") ? { name: contact.name, display_name: contact.display_name } : {}),
      ...(canRead(ctx, "email") ? { email: contact.email } : {}),
      ...(canRead(ctx, "phone_number") ? { phone: contact.phone_number } : {}),
      ...(canRead(ctx, "company") ? { company: contact.company } : {}),
      ...(canRead(ctx, "city") ? { city: contact.city } : {}),
      ...(canRead(ctx, "state") ? { state: contact.state } : {}),
      ...(canRead(ctx, "custom_fields") ? { custom_fields: contact.custom_fields ?? {} } : {}),
      ...(canRead(ctx, "tags") ? { tags: contact.tags ?? [] } : {}),
      source: contact.source,
      consent: contact.consent ?? {},
      is_blocked: contact.is_blocked,
      is_anonymized: contact.is_anonymized,
      cpf_available: contact.cpf_available,
      created_at: contact.created_at,
      last_activity_at: contact.last_activity_at,
    };
  },
};

const updateInputShape = {
  contact_id: z.string().uuid().describe("UUID do contato já identificado."),
  name: z.string().trim().min(1).max(200).optional(),
  display_name: z.string().trim().min(1).max(200).optional(),
  email: z.string().email().optional(),
  phone_number: z
    .string()
    .regex(/^\+\d{8,15}$/, "Use E.164, por exemplo +5547999999999")
    .optional(),
  company: z.string().trim().max(200).optional(),
  city: z.string().trim().max(120).optional(),
  state: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/)
    .transform((value) => value.toUpperCase())
    .optional(),
  add_tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  remove_tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  custom_fields: z
    .record(z.string().max(80), z.union([z.string().max(500), z.number(), z.boolean(), z.null()]))
    .optional(),
};

export const crmUpdateContact: McpToolDefinition<typeof updateInputShape> = {
  name: "crm_update_contact",
  description:
    "Atualiza somente dados comerciais confirmados do contato: nome, email, telefone, empresa, cidade/UF, tags e campos personalizados. " +
    "Nunca altera CPF, consentimento, bloqueio, origem, controles da IA ou dados administrativos. Preserve o valor existente quando o cliente não confirmou uma mudança.",
  inputSchema: updateInputShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const fieldsToWrite = [
      ...(input.name !== undefined || input.display_name !== undefined ? ["name"] : []),
      ...(input.email !== undefined ? ["email"] : []),
      ...(input.phone_number !== undefined ? ["phone_number"] : []),
      ...(input.company !== undefined ? ["company"] : []),
      ...(input.city !== undefined ? ["city"] : []),
      ...(input.state !== undefined ? ["state"] : []),
      ...(input.add_tags !== undefined || input.remove_tags !== undefined ? ["tags"] : []),
      ...(input.custom_fields !== undefined ? ["custom_fields"] : []),
    ];
    assertCanWrite(ctx, fieldsToWrite);
    const existing = await getContactHandler(
      ctx.supabase,
      { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId },
      { contactId: input.contact_id, decryptPurpose: null },
    );
    if (existing.organization_id !== ctx.organizationId) throw new Error("not_found");
    const currentTags = new Set(existing.tags ?? []);
    for (const tag of input.add_tags ?? []) currentTags.add(tag);
    for (const tag of input.remove_tags ?? []) currentTags.delete(tag);
    const { contact_id: _contactId, add_tags, remove_tags, custom_fields, ...fields } = input;
    void _contactId;
    void add_tags;
    void remove_tags;
    const patch = {
      ...fields,
      ...(input.add_tags !== undefined || input.remove_tags !== undefined
        ? { tags: [...currentTags] }
        : {}),
      ...(custom_fields
        ? { custom_fields: { ...(existing.custom_fields ?? {}), ...custom_fields } }
        : {}),
    };
    const contact = await patchContactHandler(
      ctx.supabase,
      { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId },
      input.contact_id,
      patch,
    );
    return {
      contact: {
        id: contact.id,
        name: contact.name ?? contact.display_name,
        email: contact.email,
        phone: contact.phone_number,
        company: contact.company,
        city: contact.city,
        state: contact.state,
        tags: contact.tags,
        custom_fields: contact.custom_fields,
      },
    };
  },
};

const noteInputShape = {
  contact_id: z.string().uuid(),
  note: z
    .string()
    .trim()
    .min(3)
    .max(2000)
    .describe("Observação comercial objetiva confirmada durante o atendimento."),
};

export const crmAddContactNote: McpToolDefinition<typeof noteInputShape> = {
  name: "crm_add_contact_note",
  description:
    "Registra uma observação confirmada na timeline do negócio aberto mais recente deste contato. Não invente nem deduza dados.",
  inputSchema: noteInputShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    assertCanWrite(ctx, ["notes"]);
    const { data: contact } = await ctx.supabase
      .from("contacts")
      .select("id,is_anonymized")
      .eq("id", input.contact_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (!contact || contact.is_anonymized)
      throw new Error(contact ? "contact_anonymized" : "not_found");
    const { data: lead } = await ctx.supabase
      .from("crm_leads")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("contact_id", input.contact_id)
      .eq("status", "open")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!lead) throw new Error("open_lead_required");
    const result = await emitLeadActivity(ctx.supabase, {
      organizationId: ctx.organizationId,
      leadId: lead.id,
      contactId: input.contact_id,
      type: "note",
      sourceModule: "ai_contact_profile",
      sourceId: ctx.requestId,
      actor: ctx.actor,
      reason: "Observação comercial confirmada durante o atendimento",
      payload: { note: input.note },
    });
    if (!result.ok) throw new Error(result.error ?? "note_write_failed");
    return { recorded: true, lead_id: lead.id };
  },
};
