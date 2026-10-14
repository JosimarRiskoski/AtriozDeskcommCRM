import { describe, expect, it } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

const {
  evolutionReceiptId,
  isProcessableEvolutionEvent,
  isProtocolOnlyEvolutionUpsert,
  isProtocolOnlyEvolutionUpsertData,
  isRedundantEvolutionConnectionUpdate,
  normalizeEvolutionMessage,
} = await import("./ingest");

describe("isRedundantEvolutionConnectionUpdate", () => {
  const session = {
    id: "session-1",
    organization_id: "org-1",
    external_session_name: "whatsapp-1",
    status: "WORKING",
    status_reason: null,
    is_warmup_complete: true,
    warmup_started_at: null,
  };

  it("ignora notificações repetidas de conexão estável", () => {
    expect(
      isRedundantEvolutionConnectionUpdate(session, {
        event: "CONNECTION_UPDATE",
        data: { state: "open" },
      }),
    ).toBe(true);
  });

  it("preserva transições reais, limpeza de motivo e fim do aquecimento", () => {
    const open = { event: "CONNECTION_UPDATE", data: { state: "open" } };
    expect(isRedundantEvolutionConnectionUpdate({ ...session, status: "STARTING" }, open)).toBe(false);
    expect(isRedundantEvolutionConnectionUpdate({ ...session, status_reason: "offline" }, open)).toBe(false);
    expect(
      isRedundantEvolutionConnectionUpdate(
        { ...session, is_warmup_complete: false, warmup_started_at: "2026-10-12T12:00:00Z" },
        open,
      ),
    ).toBe(false);
  });

  it("não interfere nos recibos e mensagens", () => {
    expect(
      isRedundantEvolutionConnectionUpdate(session, { event: "MESSAGES_UPSERT", data: {} }),
    ).toBe(false);
  });
});

describe("isProcessableEvolutionEvent", () => {
  it.each(["MESSAGES_UPSERT", "messages.update", "send-message-update", "CONNECTION_UPDATE"])(
    "aceita evento operacional %s",
    (event) => {
      expect(isProcessableEvolutionEvent(event)).toBe(true);
    },
  );

  it.each(["MESSAGES_SET", "CONTACTS_UPSERT", "CHATS_UPSERT", "GROUPS_UPSERT", undefined])(
    "ignora evento sem uso operacional %s",
    (event) => {
      expect(isProcessableEvolutionEvent(event)).toBe(false);
    },
  );
});

describe("isProtocolOnlyEvolutionUpsert", () => {
  const data = (message: Record<string, unknown>) => ({
    key: { id: "message-1", remoteJid: "5547999999999@s.whatsapp.net" },
    message,
  });

  it.each([
    { senderKeyDistributionMessage: { groupId: "group" } },
    { messageContextInfo: { deviceListMetadata: {} } },
    { senderKeyDistributionMessage: {}, messageContextInfo: {} },
  ])("ignora apenas pacotes de protocolo %o", (message) => {
    expect(isProtocolOnlyEvolutionUpsertData(data(message))).toBe(true);
  });

  it.each([
    { conversation: "oi" },
    { messageContextInfo: {}, conversation: "oi" },
    { audioMessage: { mimetype: "audio/ogg" } },
    { ephemeralMessage: { message: { conversation: "oi" } } },
    { reactionMessage: { text: "👍" } },
    {},
  ])("preserva mensagem possivelmente útil %o", (message) => {
    expect(isProtocolOnlyEvolutionUpsertData(data(message))).toBe(false);
  });

  it("ignora lote somente de protocolo, mas preserva lote misto e outros eventos", () => {
    const protocol = data({ messageContextInfo: {} });
    const text = data({ conversation: "oi" });
    expect(isProtocolOnlyEvolutionUpsert({ event: "messages.upsert", data: [protocol] })).toBe(true);
    expect(isProtocolOnlyEvolutionUpsert({ event: "MESSAGES_UPSERT", data: [protocol, text] })).toBe(false);
    expect(isProtocolOnlyEvolutionUpsert({ event: "MESSAGES_UPDATE", data: [protocol] })).toBe(false);
  });
});

describe("normalizeEvolutionMessage", () => {
  it("detecta mídia sem base64 para o worker baixá-la pela Evolution", () => {
    const result = normalizeEvolutionMessage({
      key: { id: "media-1", fromMe: false, remoteJid: "5547999999999@s.whatsapp.net" },
      message: { imageMessage: { mimetype: "image/jpeg", caption: "foto" } },
    });

    expect(result?.hasMedia).toBe(true);
    expect(result?.mediaUrl).toBeUndefined();
    expect(result?._data?.evolution_message).toBeTruthy();
  });

  it("preserva o pushName real em mensagens recebidas", () => {
    const result = normalizeEvolutionMessage({
      key: { id: "in-1", fromMe: false, remoteJid: "5547999999999@s.whatsapp.net" },
      pushName: "Rafael Souza",
      message: { conversation: "oi" },
    });

    expect(result?._data?.pushName).toBe("Rafael Souza");
  });

  it("ignora o pushName da conta conectada em mensagens enviadas", () => {
    const result = normalizeEvolutionMessage({
      key: { id: "out-1", fromMe: true, remoteJid: "5547999999999@s.whatsapp.net" },
      pushName: "Josimar Riskoski",
      message: { conversation: "teste" },
    });

    expect(result?._data?.pushName).toBeUndefined();
  });
});

describe("evolutionReceiptId", () => {
  it.each([
    [{ key: { id: "baileys-id" } }, "baileys-id"],
    [{ id: "legacy-id" }, "legacy-id"],
    [{ keyId: "evolution-v2-id" }, "evolution-v2-id"],
  ])("reconhece o ID do recibo em %o", (payload, expected) => {
    expect(evolutionReceiptId(payload)).toBe(expected);
  });
});
