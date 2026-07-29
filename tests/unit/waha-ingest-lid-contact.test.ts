import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { dispatchWahaEvent } from "@/lib/waha/ingest";

function fakeAdmin() {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const table = {
    insert: () => ({
      select: () => ({ maybeSingle: async () => ({ data: { id: "msg-1" }, error: null }) }),
    }),
    update: () => ({ eq: async () => ({ error: null }) }),
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: null, error: null }),
        order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }),
    }),
  };
  return {
    calls,
    admin: {
      from: () => table,
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

  it("continua a ingestao pelo LID quando o mapeamento ainda nao existe", async () => {
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
      p_kind: "lid",
      p_phone: null,
      p_lid: "203392655843435",
    });
  });
});
