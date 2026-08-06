import { describe, expect, it } from "vitest";

import { resolveEvolutionRemoteJid } from "@/lib/evolution/message-identity";

describe("resolveEvolutionRemoteJid", () => {
  it("usa o telefone alternativo quando a Evolution entrega remoteJid como LID", () => {
    expect(
      resolveEvolutionRemoteJid({
        remoteJid: "123456789@lid",
        remoteJidAlt: "554788976484@s.whatsapp.net",
      }),
    ).toEqual({
      remoteJid: "554788976484@s.whatsapp.net",
      usedAlternatePhone: true,
    });
  });

  it("mantém o LID quando a Evolution não fornece telefone alternativo", () => {
    expect(resolveEvolutionRemoteJid({ remoteJid: "123456789@lid" })).toEqual({
      remoteJid: "123456789@lid",
      usedAlternatePhone: false,
    });
  });
});
