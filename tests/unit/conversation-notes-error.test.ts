import { describe, expect, it } from "vitest";
import { describeConversationNotesLoadError } from "@/hooks/inbox/useConversationNotes";
import { ApiError } from "@/lib/api/types";

describe("describeConversationNotesLoadError", () => {
  it("identifica a falha da API e preserva o identificador para suporte", () => {
    expect(
      describeConversationNotesLoadError(
        new ApiError(500, "internal_error", undefined, "req-notes-123", "Erro ao listar notas."),
      ),
    ).toEqual({
      title: "Não foi possível carregar as notas internas.",
      description: "Erro ao listar notas. · ID: req-notes-123",
    });
  });

  it("explica quando a solicitação expirou", () => {
    expect(describeConversationNotesLoadError(new DOMException("", "AbortError"))).toEqual({
      title: "Não foi possível carregar as notas internas.",
      description: "A solicitação demorou mais de 10 segundos para responder.",
    });
  });

  it("explica quando não foi possível alcançar o CRM", () => {
    expect(describeConversationNotesLoadError(new TypeError("Failed to fetch"))).toEqual({
      title: "Não foi possível carregar as notas internas.",
      description: "Não foi possível conectar ao CRM. Verifique a conexão e tente novamente.",
    });
  });
});
