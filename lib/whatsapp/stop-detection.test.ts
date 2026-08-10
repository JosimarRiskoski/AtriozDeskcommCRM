import { describe, expect, it } from "vitest";

import { isExplicitStopRequest } from "@/lib/whatsapp/stop-detection";

describe("isExplicitStopRequest", () => {
  it.each([
    "STOP",
    "parar",
    "SAIR por favor",
    "unsubscribe",
    "Não quero mais receber mensagens",
    "Pare de me mandar mensagens, por favor",
    "Não me envie mais propaganda!",
    "Quero parar de receber as mensagens",
    "Remova meu número da lista",
    "Pode me descadastrar",
  ])("aceita pedido explicito: %s", (message) => {
    expect(isExplicitStopRequest(message)).toBe(true);
  });

  it.each([
    "Vou sair agora",
    "Pode parar por aqui que amanhã continuamos",
    "Meu filho vai sair mais cedo",
    "Não quero mais receber o documento hoje",
    "Vamos parar para almoçar",
    "A saída fica do outro lado",
    "",
  ])("nao bloqueia conversa comum: %s", (message) => {
    expect(isExplicitStopRequest(message)).toBe(false);
  });
});
