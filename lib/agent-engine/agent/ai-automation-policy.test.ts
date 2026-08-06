import { describe, expect, it } from "vitest";

import { decideInboundAiPolicy } from "./ai-automation-policy";

describe("decideInboundAiPolicy", () => {
  it("permite todas as conversas elegíveis quando a chave geral está ligada", () => {
    expect(
      decideInboundAiPolicy({ mode: "inherit", enabledForAll: true, humanAttending: false }),
    ).toEqual({ allowed: true });
  });

  it("com a chave geral desligada permite somente a exceção manual", () => {
    expect(
      decideInboundAiPolicy({ mode: "inherit", enabledForAll: false, humanAttending: false }),
    ).toEqual({ allowed: false, reason: "general_disabled" });
    expect(
      decideInboundAiPolicy({ mode: "force_active", enabledForAll: false, humanAttending: false }),
    ).toEqual({ allowed: true });
  });

  it("a pausa individual vence a chave geral", () => {
    expect(
      decideInboundAiPolicy({ mode: "force_paused", enabledForAll: true, humanAttending: false }),
    ).toEqual({ allowed: false, reason: "paused" });
  });

  it("não permite a IA enquanto houver atendente humano", () => {
    expect(
      decideInboundAiPolicy({ mode: "force_active", enabledForAll: false, humanAttending: true }),
    ).toEqual({ allowed: false, reason: "human_attending" });
  });
});
