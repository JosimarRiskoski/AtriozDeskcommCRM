import { describe, expect, it } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

const { evolutionReceiptId, isProcessableEvolutionEvent, normalizeEvolutionMessage } = await import("./ingest");

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
