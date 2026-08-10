import { describe, expect, it } from "vitest";

import { buildEvolutionReadKeys } from "@/lib/evolution/read-receipts";

describe("buildEvolutionReadKeys", () => {
  it("preserva o remoteJid real recebido da Evolution", () => {
    expect(
      buildEvolutionReadKeys(
        [
          {
            external_id: "MSG-1",
            metadata: {
              evolution_message: { key: { remoteJid: "5511999990000@s.whatsapp.net" } },
            },
          },
        ],
        "+55 11 8888-0000",
      ),
    ).toEqual([
      { id: "MSG-1", fromMe: false, remoteJid: "5511999990000@s.whatsapp.net" },
    ]);
  });

  it("usa o telefone normalizado quando o payload não contém remoteJid", () => {
    expect(
      buildEvolutionReadKeys(
        [{ external_id: "MSG-2", metadata: {} }],
        "+55 (11) 98888-7777",
      ),
    ).toEqual([
      { id: "MSG-2", fromMe: false, remoteJid: "5511988887777@s.whatsapp.net" },
    ]);
  });

  it("não envia chave incompleta ou mensagem sem ID", () => {
    expect(
      buildEvolutionReadKeys(
        [
          { external_id: null, metadata: {} },
          { external_id: "MSG-3", metadata: {} },
        ],
        "",
      ),
    ).toEqual([]);
  });
});
