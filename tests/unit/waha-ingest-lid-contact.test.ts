import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { dispatchWahaEvent } from "@/lib/waha/ingest";

function fakeAdmin() {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const tableCalls: Array<{ table: string; operation: string; payload: unknown }> = [];
  const table = {
    insert: () => ({
      select: () => ({ maybeSingle: async () => ({ data: { id: "msg-1" }, error: null }) }),
    }),
    update: () => ({ eq: async () => ({ error: null }) }),
    select: () => {
      const chain = {
        eq: () => chain,
        in: () => chain,
        is: () => chain,
        order: () => chain,
        limit: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return chain;
    },
  };
  return {
    calls,
    tableCalls,
    admin: {
      from: (name: string) => {
        if (name !== "whatsapp_inbound_pending") return table;
        const chain = {
          eq: () => chain,
          in: () => chain,
          order: () => chain,
          limit: async () => ({ data: [], error: null }),
        };
        return {
          upsert: async (payload: unknown) => {
            tableCalls.push({ table: name, operation: "upsert", payload });
            return { error: null };
          },
          select: () => chain,
          update: () => ({ eq: () => ({ in: async () => ({ error: null }) }) }),
        };
      },
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (fn === "fn_upsert_wa_contact") return { data: "contact-1", error: null };
        if (fn === "fn_upsert_wa_conversation") return { data: "conversation-1", error: null };
        return { data: null, error: null };
      },
    },
  };
}

describe("ingestao de contato @lid", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WAHA_API_BASE_URL;
    delete process.env.WAHA_API_KEY;
  });

  it("envia telefone e LID juntos para o upsert atomico quando o WAHA resolve", async () => {
    process.env.WAHA_API_BASE_URL = "http://waha:3000";
    process.env.WAHA_API_KEY = "secret";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ lid: "203392655843435@lid", pn: "554788976484@c.us" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const { admin, calls } = fakeAdmin();

    await dispatchWahaEvent(
      admin as never,
      {
        id: "session-id",
        organization_id: "org-id",
        waha_session_name: "org_session",
        is_warmup_complete: true,
        warmup_started_at: null,
      },
      {
        event: "message",
        payload: {
          id: "message-id",
          from: "203392655843435@lid",
          fromMe: false,
          body: "ola",
        },
      },
      "request-id",
    );

    const upsert = calls.find((call) => call.fn === "fn_upsert_wa_contact");
    expect(upsert?.args).toMatchObject({
      p_kind: "resolved",
      p_phone: "+554788976484",
      p_lid: "203392655843435",
      p_chat_id: "203392655843435@lid",
    });
  });

  it("preserva a mensagem sem criar contato quando o LID ainda nao foi resolvido", async () => {
    process.env.WAHA_API_BASE_URL = "http://waha:3000";
    process.env.WAHA_API_KEY = "secret";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ lid: "203392655843435@lid", pn: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const { admin, calls, tableCalls } = fakeAdmin();

    await dispatchWahaEvent(
      admin as never,
      {
        id: "session-id",
        organization_id: "org-id",
        waha_session_name: "org_session",
        is_warmup_complete: true,
        warmup_started_at: null,
      },
      {
        event: "message",
        payload: {
          id: "message-id",
          from: "203392655843435@lid",
          fromMe: false,
          body: "ola",
        },
      },
      "request-id",
    );

    const upsert = calls.find((call) => call.fn === "fn_upsert_wa_contact");
    expect(upsert).toBeUndefined();
    expect(tableCalls).toContainEqual({
      table: "whatsapp_inbound_pending",
      operation: "upsert",
      payload: expect.objectContaining({
        external_id: "message-id",
        lid: "203392655843435",
        status: "pending",
      }),
    });
  });
});
