import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { claimMessageSend, hashMessageSend } from "@/app/api/v1/messages/_idempotency";

const input = {
  conversation_id: "4687b9fa-e10e-41a2-b116-0da1c147bb32",
  type: "text" as const,
  body: "chegou",
};

function fakeClient(options: {
  insertError?: { code: string; message: string } | null;
  lookup?: Record<string, unknown> | null;
}) {
  const insert = vi.fn(async () => ({ error: options.insertError ?? null }));
  const builder = {
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: options.lookup ?? null, error: null })),
  };
  builder.eq.mockReturnValue(builder);
  const select = vi.fn(() => builder);
  const from = vi.fn(() => ({ insert, select }));
  return { client: { from } as unknown as SupabaseClient, insert };
}

describe("idempotência do envio manual", () => {
  it("reserva a primeira tentativa antes de chamar a Evolution", async () => {
    const db = fakeClient({});
    await expect(claimMessageSend(db.client, "org-1", "key-1", input)).resolves.toEqual({
      state: "claimed",
      requestHash: hashMessageSend(input),
    });
    expect(db.insert).toHaveBeenCalledOnce();
    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({ request_hash: `\\x${hashMessageSend(input)}` }),
    );
  });

  it("bloqueia uma repetição enquanto a primeira tentativa ainda está processando", async () => {
    const db = fakeClient({
      insertError: { code: "23505", message: "duplicate key" },
      lookup: {
        request_hash: hashMessageSend(input),
        status_code: 102,
        response_body: { state: "processing" },
      },
    });
    await expect(claimMessageSend(db.client, "org-1", "key-1", input)).resolves.toEqual({
      state: "processing",
    });
  });

  it("devolve a mensagem já criada sem fazer um novo envio", async () => {
    const message = { id: "message-1", body: "chegou", status: "sent" };
    const db = fakeClient({
      insertError: { code: "23505", message: "duplicate key" },
      lookup: {
        request_hash: `\\x${hashMessageSend(input)}`,
        status_code: 201,
        response_body: message,
      },
    });
    await expect(claimMessageSend(db.client, "org-1", "key-1", input)).resolves.toEqual({
      state: "cached",
      message,
    });
  });
});
