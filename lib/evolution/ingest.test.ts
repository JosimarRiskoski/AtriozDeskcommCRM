import { describe, expect, it } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

const { normalizeEvolutionMessage } = await import("./ingest");

describe("normalizeEvolutionMessage", () => {
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
