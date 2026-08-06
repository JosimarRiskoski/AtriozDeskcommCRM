import { describe, expect, it } from "vitest";

import { detectHumanHandoffRequest } from "./human-handoff";

describe("detectHumanHandoffRequest", () => {
  it.each([
    "atendente",
    "ATENDENTE!",
    "quero um atendente",
    "preciso de uma pessoa",
    "quero falar com alguém",
    "me transfira para um atendente",
    "atendimento humano",
  ])("aciona handoff imediato para pedido explícito: %s", (message) => {
    expect(detectHumanHandoffRequest(message)).toBe(true);
  });

  it.each(["nossa atendente explicou tudo", "sou uma pessoa tranquila", "o atendimento foi bom"])(
    "não transfere por simples menção: %s",
    (message) => {
      expect(detectHumanHandoffRequest(message)).toBe(false);
    },
  );
});
