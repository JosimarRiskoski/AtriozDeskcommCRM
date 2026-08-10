import { beforeEach, describe, expect, it, vi } from "vitest";

const { embedMock, embeddingModelMock, loadLatestCredentialMock } = vi.hoisted(() => ({
  embedMock: vi.fn(),
  embeddingModelMock: vi.fn().mockReturnValue({ provider: "openai.embedding" }),
  loadLatestCredentialMock: vi.fn(),
}));

vi.mock("ai", () => ({ embed: embedMock }));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({ embedding: embeddingModelMock }),
}));
vi.mock("@/lib/ai/credentials", () => ({
  loadLatestCredential: loadLatestCredentialMock,
}));
vi.mock("@/lib/env", () => ({
  env: { AI_GATEWAY_API_KEY: "", OPENAI_API_KEY: "" },
}));

import { embedText } from "./embed";

describe("embedText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadLatestCredentialMock.mockResolvedValue({
      apiKey: "segredo",
      provider: "openai",
      label: "Gpt",
    });
    embedMock.mockResolvedValue({ embedding: [0.1, 0.2], usage: { tokens: 3 } });
  });

  it("usa a credencial OpenAI validada do CRM quando não existe chave no servidor", async () => {
    const result = await embedText("conteúdo", { organizationId: "org-1" });

    expect(loadLatestCredentialMock).toHaveBeenCalledWith("openai", "org-1");
    expect(embeddingModelMock).toHaveBeenCalledWith("text-embedding-3-small");
    expect(embedMock).toHaveBeenCalledWith(expect.objectContaining({ value: "conteúdo" }));
    expect(result).toMatchObject({ embedding: [0.1, 0.2], promptTokens: 3 });
  });
});
