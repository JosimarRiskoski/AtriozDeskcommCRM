import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadMock = vi.fn();
const updateEqMock = vi.fn();
const rpcMock = vi.fn();
const { fetchEvolutionMessageMediaMock } = vi.hoisted(() => ({
  fetchEvolutionMessageMediaMock: vi.fn(),
}));
const messageRow = {
  id: "msg1",
  organization_id: "org1",
  conversation_id: "conv1",
  channel_session_id: "session1",
  media_url: "https://evolution.test/media/abc" as string | null,
  media_mime: "audio/ogg",
  media_storage_path: null as string | null,
  metadata: { raw_type: "audio", evolution_message: { key: { id: "ext1" } } },
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "channel_sessions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { provider: "evolution", external_session_name: "crm-principal" },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: messageRow, error: null }) }),
          }),
        }),
        update: (patch: Record<string, unknown>) => {
          updateEqMock(patch);
          return { eq: () => ({ eq: async () => ({ error: null }) }) };
        },
      };
    },
    storage: { from: () => ({ upload: uploadMock }) },
    rpc: rpcMock,
  }),
}));

vi.mock("@/lib/messaging/media/evolution-api-source", () => ({
  fetchEvolutionMessageMedia: fetchEvolutionMessageMediaMock,
}));

import { persistMessageMedia } from "@/workers/media-persist-worker";

function eventRow(attempts = 0) {
  return {
    id: "ev1",
    organization_id: "org1",
    event_type: "media.persist_requested",
    entity_kind: "message",
    entity_id: "msg1",
    payload: { message_id: "msg1" },
    metadata: {},
    consumed_by: [],
    attempts,
  };
}

describe("persistMessageMedia com Evolution", () => {
  beforeEach(() => {
    uploadMock.mockReset().mockResolvedValue({ error: null });
    updateEqMock.mockReset();
    rpcMock.mockReset().mockResolvedValue({ error: null });
    fetchEvolutionMessageMediaMock.mockReset().mockResolvedValue({
      buffer: Buffer.from([1, 2, 3]),
      mime: "audio/ogg",
    });
    messageRow.media_storage_path = null;
    messageRow.media_url = "https://evolution.test/media/abc";
  });

  it("baixa pela Evolution, persiste no bucket e atualiza a mensagem", async () => {
    const result = await persistMessageMedia(eventRow());
    expect(result.status).toBe("ok");
    expect(fetchEvolutionMessageMediaMock).toHaveBeenCalledWith(
      expect.objectContaining({ instanceName: "crm-principal", message: messageRow.metadata.evolution_message }),
    );
    expect(uploadMock).toHaveBeenCalledWith(
      "org1/conv1/msg1.ogg",
      expect.any(Buffer),
      expect.objectContaining({ contentType: "audio/ogg", upsert: true }),
    );
    expect(updateEqMock).toHaveBeenCalledWith(
      expect.objectContaining({
        media_storage_path: "org1/conv1/msg1.ogg",
        media_size_bytes: 3,
        metadata: expect.objectContaining({ media_status: "stored" }),
      }),
    );
  });

  it("usa a mensagem Evolution mesmo sem URL direta", async () => {
    messageRow.media_url = null;
    const result = await persistMessageMedia(eventRow());
    expect(result.status).toBe("ok");
    expect(fetchEvolutionMessageMediaMock).toHaveBeenCalled();
  });

  it("pula mensagem já persistida", async () => {
    messageRow.media_storage_path = "org1/conv1/msg1.ogg";
    expect((await persistMessageMedia(eventRow())).status).toBe("skipped");
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("mantém retry antes da última tentativa", async () => {
    fetchEvolutionMessageMediaMock.mockRejectedValue(new Error("evolution_503"));
    expect((await persistMessageMedia(eventRow(1))).status).toBe("error");
    expect(updateEqMock).not.toHaveBeenCalled();
  });

  it("marca falha permanente na última tentativa", async () => {
    fetchEvolutionMessageMediaMock.mockRejectedValue(new Error("evolution_503"));
    expect((await persistMessageMedia(eventRow(4))).status).toBe("error");
    expect(updateEqMock).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ media_status: "failed" }) }),
    );
  });
});
