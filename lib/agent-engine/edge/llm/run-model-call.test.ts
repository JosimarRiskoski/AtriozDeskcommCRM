import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: {} }));

import { normalizeProviderError } from "./run-model-call";

describe("normalizeProviderError", () => {
  it("traduz erro de autenticação sem expor a chave", () => {
    const error = Object.assign(
      new Error("Incorrect API key sk-projeto-segredo123456789 para cliente@empresa.com"),
      { status: 401 },
    );

    expect(normalizeProviderError(error)).toEqual({
      errorCode: "credencial_recusada",
      errorMessage: "Incorrect API key [CHAVE_REMOVIDA] para [EMAIL_REMOVIDO]",
      httpStatus: 401,
    });
  });

  it("distingue falta de saldo de indisponibilidade do provedor", () => {
    expect(
      normalizeProviderError(Object.assign(new Error("insufficient balance"), { status: 429 })),
    ).toMatchObject({ errorCode: "limite_ou_saldo", httpStatus: 429 });
    expect(
      normalizeProviderError(Object.assign(new Error("provider timeout"), { status: 503 })),
    ).toMatchObject({ errorCode: "provedor_indisponivel", httpStatus: 503 });
  });
});
