import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  getContactHandler: vi.fn(),
  patchContactHandler: vi.fn(),
  emitLeadActivity: vi.fn(),
}));

vi.mock("@/app/api/v1/contacts/_handler", () => ({
  listContactsHandler: vi.fn(),
  getContactHandler: mocks.getContactHandler,
  patchContactHandler: mocks.patchContactHandler,
}));
vi.mock("@/lib/leads/activity-emitter", () => ({ emitLeadActivity: mocks.emitLeadActivity }));

import { crmAddContactNote, crmGetContact, crmUpdateContact } from "@/lib/mcp/tools/contacts";
import type { McpContext } from "@/lib/mcp/types";

const CONTACT_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

function ctx(contactFieldAccess?: McpContext["contactFieldAccess"]): McpContext {
  return {
    organizationId: ORG_ID,
    role: "manager",
    actor: { type: "ai_agent", id: "33333333-3333-4333-8333-333333333333", role: "manager" },
    apiTokenId: "44444444-4444-4444-8444-444444444444",
    requestId: "req-contact-update",
    contactFieldAccess,
    supabase: {} as McpContext["supabase"],
  };
}

describe("crm_update_contact", () => {
  const args = (value: Record<string, unknown>) =>
    z.object(crmUpdateContact.inputSchema).parse(value) as never;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getContactHandler.mockResolvedValue({
      id: CONTACT_ID,
      organization_id: ORG_ID,
      name: "Débora",
      display_name: "Débora",
      email: null,
      phone_number: "+5547999999999",
      company: null,
      city: null,
      state: null,
      custom_fields: { origem_confirmada: "WhatsApp" },
      tags: ["cliente"],
    });
    mocks.patchContactHandler.mockImplementation(async (_sb, _ctx, id, patch) => ({
      id,
      name: "Débora",
      display_name: "Débora",
      email: null,
      phone_number: "+5547999999999",
      company: patch.company ?? null,
      city: patch.city ?? null,
      state: patch.state ?? null,
      custom_fields: patch.custom_fields ?? {},
      tags: patch.tags ?? ["cliente"],
    }));
  });

  it("mescla tags e campos confirmados sem apagar dados anteriores", async () => {
    const result = await crmUpdateContact.handler(
      args({
        contact_id: CONTACT_ID,
        company: "Atrioz",
        city: "Rio do Sul",
        state: "SC",
        add_tags: ["qualificado"],
        remove_tags: ["cliente"],
        custom_fields: { faixa_consumo: "R$ 500" },
      }),
      ctx(),
    );

    expect(mocks.patchContactHandler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organization_id: ORG_ID }),
      CONTACT_ID,
      expect.objectContaining({
        company: "Atrioz",
        city: "Rio do Sul",
        state: "SC",
        tags: ["qualificado"],
        custom_fields: { origem_confirmada: "WhatsApp", faixa_consumo: "R$ 500" },
      }),
    );
    expect(result).toMatchObject({ contact: { id: CONTACT_ID, company: "Atrioz" } });
  });

  it("não expõe consentimento, CPF, bloqueio ou controles da IA no contrato", () => {
    const schema = z.object(crmUpdateContact.inputSchema);
    const parsed = schema.parse({
      contact_id: CONTACT_ID,
      name: "Débora",
      consent: { marketing: true },
      cpf: "00000000000",
      is_blocked: false,
      force_human: false,
    });
    expect(parsed).toEqual({ contact_id: CONTACT_ID, name: "Débora" });
  });

  it("recusa contato de outra organização mesmo com service role", async () => {
    mocks.getContactHandler.mockResolvedValueOnce({
      id: CONTACT_ID,
      organization_id: "55555555-5555-4555-8555-555555555555",
      tags: [],
      custom_fields: {},
    });
    await expect(
      crmUpdateContact.handler(args({ contact_id: CONTACT_ID, name: "Outro" }), ctx()),
    ).rejects.toThrow("not_found");
    expect(mocks.patchContactHandler).not.toHaveBeenCalled();
  });

  it("recusa alteracao de campo liberado apenas para leitura", async () => {
    await expect(
      crmUpdateContact.handler(
        args({ contact_id: CONTACT_ID, city: "Rio do Sul" }),
        ctx({ city: "read" }),
      ),
    ).rejects.toThrow("contact_field_write_denied:city");
    expect(mocks.patchContactHandler).not.toHaveBeenCalled();
  });

  it("omite campos que o agente nao pode ler", async () => {
    const input = z.object(crmGetContact.inputSchema).parse({ contact_id: CONTACT_ID }) as never;
    const result = await crmGetContact.handler(
      input,
      ctx({ name: "read", email: "none", phone_number: "none", tags: "read" }),
    );

    expect(result).toMatchObject({ id: CONTACT_ID, tags: ["cliente"] });
    expect(result).toHaveProperty("name");
    expect(result).not.toHaveProperty("email");
    expect(result).not.toHaveProperty("phone");
  });
});

describe("crm_add_contact_note", () => {
  it("recusa anotacao quando observacoes nao estao liberadas", async () => {
    const input = z.object(crmAddContactNote.inputSchema).parse({
      contact_id: CONTACT_ID,
      note: "Informacao confirmada pelo cliente.",
    }) as never;

    await expect(crmAddContactNote.handler(input, ctx({ notes: "none" }))).rejects.toThrow(
      "contact_field_write_denied:notes",
    );
    expect(mocks.emitLeadActivity).not.toHaveBeenCalled();
  });

  it("registra a observação no negócio aberto do mesmo contato", async () => {
    const leadId = "66666666-6666-4666-8666-666666666666";
    const fakeSupabase = {
      from(table: string) {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () =>
            table === "contacts"
              ? { data: { id: CONTACT_ID, is_anonymized: false }, error: null }
              : { data: { id: leadId }, error: null },
        };
        return chain;
      },
    };
    mocks.emitLeadActivity.mockResolvedValueOnce({ ok: true });
    const context = { ...ctx(), supabase: fakeSupabase as unknown as McpContext["supabase"] };
    const args = z
      .object(crmAddContactNote.inputSchema)
      .parse({ contact_id: CONTACT_ID, note: "Prefere atendimento depois das 18h." }) as never;

    const result = await crmAddContactNote.handler(args, context);

    expect(mocks.emitLeadActivity).toHaveBeenCalledWith(
      context.supabase,
      expect.objectContaining({
        organizationId: ORG_ID,
        leadId,
        contactId: CONTACT_ID,
        type: "note",
        payload: { note: "Prefere atendimento depois das 18h." },
      }),
    );
    expect(result).toEqual({ recorded: true, lead_id: leadId });
  });
});
