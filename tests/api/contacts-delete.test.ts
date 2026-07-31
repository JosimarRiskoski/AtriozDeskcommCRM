import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const CONTACT_ID = "33333333-3333-4333-8333-333333333333";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";

function dbWithHistory({ conversations = 0, messages = 0 } = {}) {
  let deleted = false;
  const contact = {
    id: CONTACT_ID,
    organization_id: ORG_ID,
    name: "Contato teste",
    display_name: null,
    email: null,
    phone_number: "+5547999999999",
    is_anonymized: false,
  };

  function from(table: string) {
    const mode = { value: "select" };
    const b = {
      select(_columns?: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.head) {
          const count = table === "conversations" ? conversations : messages;
          return {
            eq() {
              return this;
            },
            then(resolve: (value: unknown) => unknown) {
              return Promise.resolve({ count, error: null }).then(resolve);
            },
          };
        }
        return b;
      },
      delete() {
        mode.value = "delete";
        return b;
      },
      eq() {
        return b;
      },
      async maybeSingle() {
        if (mode.value === "delete") {
          if (deleted) return { data: null, error: null };
          deleted = true;
          return { data: { id: CONTACT_ID }, error: null };
        }
        return { data: deleted ? null : contact, error: null };
      },
    };
    return b;
  }

  return { from, wasDeleted: () => deleted };
}

function routeCtx() {
  return { params: Promise.resolve({ id: CONTACT_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER_ID },
    org: { orgId: ORG_ID, role: "manager", name: "Org" },
  } as never);
});

describe("DELETE /api/v1/contacts/:id", () => {
  it("exclui contato sem histÃ³rico", async () => {
    const db = dbWithHistory();
    vi.mocked(createClient).mockResolvedValue(db as never);
    const { DELETE } = await import("@/app/api/v1/contacts/[id]/route");

    const res = await DELETE(new NextRequest("http://localhost", { method: "DELETE" }), routeCtx());

    expect(res.status).toBe(200);
    expect(db.wasDeleted()).toBe(true);
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "contact.deleted", resourceId: CONTACT_ID }),
    );
  });

  it("protege contato com conversa", async () => {
    const db = dbWithHistory({ conversations: 1 });
    vi.mocked(createClient).mockResolvedValue(db as never);
    const { DELETE } = await import("@/app/api/v1/contacts/[id]/route");

    const res = await DELETE(new NextRequest("http://localhost", { method: "DELETE" }), routeCtx());

    expect(res.status).toBe(409);
    expect(db.wasDeleted()).toBe(false);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("contact_has_history");
  });
});
