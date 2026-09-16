import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/evolution/client", () => ({
  getEvolutionClient: vi.fn(), evolutionRecipient: vi.fn(),
  isEvolutionClosedSessionError: vi.fn(), parseEvolutionMessageId: vi.fn(),
}));
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { getEvolutionClient } from "@/lib/evolution/client";

const context = { organization_id: "org-a", actor: { type: "user" as const, id: "user", role: "admin" }, requestId: "test" };
const conversation = {
  id: "conversation", organization_id: "org-a", contact_id: "contact", channel_session_id: "channel",
  contacts: { organization_id: "org-a", is_blocked: true },
  channel_sessions: { organization_id: "org-a", provider: "evolution", status: "WORKING" },
};

function database(row: unknown) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) };
  const from = vi.fn().mockReturnValue(query);
  return { client: { from } as unknown as SupabaseClient, from, query };
}

describe("message tenant boundary", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([
    { ...conversation, organization_id: "org-b" },
    { ...conversation, contacts: { organization_id: "org-b", is_blocked: false } },
    { ...conversation, channel_sessions: { ...conversation.channel_sessions, organization_id: "org-b" } },
    { ...conversation, contacts: null },
    { ...conversation, channel_sessions: null },
  ])("rejects mismatched or unresolved resource ownership before any write", async (row) => {
    const db = database(row);
    await expect(sendMessageHandler(db.client, context, { conversation_id: "conversation", type: "text", body: "test" })).rejects.toMatchObject({ code: "not_found" });
    expect(db.from.mock.calls).toEqual([["conversations"]]);
    expect(getEvolutionClient).not.toHaveBeenCalled();
  });
  it("scopes the lookup to the authorized company and preserves the blocked-contact veto", async () => {
    const db = database(conversation);
    await expect(sendMessageHandler(db.client, context, { conversation_id: "conversation", type: "text", body: "test" })).rejects.toMatchObject({ code: "forbidden" });
    expect(db.query.eq).toHaveBeenCalledWith("organization_id", "org-a");
    expect(db.from.mock.calls).toEqual([["conversations"]]);
  });
});
