import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/webhooks/secrets", () => ({ decryptWebhookSecret: vi.fn() }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";

function mockAuthorizedAdmin() {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: {} as never,
    org: { orgId: ORG_ID, name: "Org", role: "admin" },
  });
}

function makeAdminStub(setting: Record<string, unknown> | null) {
  const builder = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    maybeSingle() {
      return Promise.resolve({ data: setting, error: null });
    },
  };
  return { from: vi.fn(() => builder) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("POST /api/v1/settings/meta-capi/validate", () => {
  it("valida pelo endpoint de eventos em modo de teste, sem dados pessoais", async () => {
    mockAuthorizedAdmin();
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminStub({
        dataset_id: "1063522036317010",
        graph_api_version: "v25.0",
        access_token_encrypted: "encrypted",
        test_event_code: "TEST25273",
      }) as never,
    );
    vi.mocked(decryptWebhookSecret).mockResolvedValue("token-test");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ events_received: 1 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const response = await POST();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.facebook.com/v25.0/1063522036317010/events",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as {
      test_event_code: string;
      data: Array<Record<string, unknown>>;
    };
    expect(payload.test_event_code).toBe("TEST25273");
    expect(payload.data[0]).toMatchObject({
      event_name: "TestEvent",
      action_source: "system_generated",
    });
    expect(payload.data[0]).toHaveProperty("user_data.external_id");
  });

  it("mostra o motivo seguro devolvido pela Meta quando o evento de teste é recusado", async () => {
    mockAuthorizedAdmin();
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminStub({
        dataset_id: "1063522036317010",
        graph_api_version: "v25.0",
        access_token_encrypted: "encrypted",
        test_event_code: "TEST25273",
      }) as never,
    );
    vi.mocked(decryptWebhookSecret).mockResolvedValue("token-test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 100, message: "Parâmetro user_data é obrigatório." } }),
          { status: 400 },
        ),
      ),
    );

    const { POST } = await import("./route");
    const response = await POST();

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { message: string; details: unknown } };
    expect(body.error.message).toContain("Parâmetro user_data é obrigatório.");
    expect(body.error.details).toEqual({ meta_error_code: 100 });
  });
});
