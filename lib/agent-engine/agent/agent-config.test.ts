import { describe, expect, it, vi } from "vitest";
import type pg from "pg";

import {
  loadPublishedAgentConfig,
  matchesHandoffKeyword,
  renderAgentControlPolicy,
} from "./agent-config";

const baseRow = {
  agent_id: "a1",
  version_id: "v1",
  agent_name: "Vendedor",
  system_prompt: "p",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  credential_id: null,
  max_steps: 8,
  history_message_window: 30,
  history_token_window: 8000,
  handoff_keywords: null,
  handoff_tool_enabled: true,
  tool_ids: null,
  contact_field_access: { name: "write", email: "read" },
  version_created_by: null,
  agent_created_by: null,
  active_kb_version_id: "kb-1",
  config: { rag_top_k: 7, rag_similarity_threshold: 0.8 },
};

function poolWith(row: Record<string, unknown> | undefined): pg.Pool {
  return { query: vi.fn().mockResolvedValue({ rows: row ? [row] : [] }) } as unknown as pg.Pool;
}

describe("loadPublishedAgentConfig — campos de RAG", () => {
  it("expõe active_kb_version_id e knobs de RAG do config", async () => {
    const cfg = await loadPublishedAgentConfig(poolWith(baseRow), "org1", "cs1");
    expect(cfg?.activeKbVersionId).toBe("kb-1");
    expect(cfg?.ragTopK).toBe(7);
    expect(cfg?.ragSimilarityThreshold).toBe(0.8);
    expect(cfg?.contactFieldAccess).toEqual({ name: "write", email: "read" });
  });

  it("cai nos defaults (5 / 0.72) quando config é nulo ou fora da faixa", async () => {
    const cfg = await loadPublishedAgentConfig(
      poolWith({ ...baseRow, config: { rag_top_k: 999, rag_similarity_threshold: -1 } }),
      "org1",
      "cs1",
    );
    expect(cfg?.ragTopK).toBe(5);
    expect(cfg?.ragSimilarityThreshold).toBe(0.72);
  });

  it("activeKbVersionId nulo quando o agente não tem KB ativa", async () => {
    const cfg = await loadPublishedAgentConfig(
      poolWith({ ...baseRow, active_kb_version_id: null }),
      "org1",
      "cs1",
    );
    expect(cfg?.activeKbVersionId).toBeNull();
  });
});

describe("controles compreensíveis do agente", () => {
  it("carrega limites, fontes e assuntos do config publicado", async () => {
    const cfg = await loadPublishedAgentConfig(
      poolWith({
        ...baseRow,
        config: {
          knowledge_base_enabled: false,
          external_internet_allowed: false,
          forbidden_topics: ["aconselhamento jurídico"],
          human_required_topics: ["documento pessoal", "fatura de energia"],
          fixed_responses: [{ topic: "preço", response: "Consulte a proposta." }],
          fallback_message: "Não encontrei.",
          daily_budget_cents: 500,
          monthly_budget_cents: 5000,
        },
      }),
      "org1",
      "cs1",
    );
    expect(cfg).toMatchObject({
      knowledgeBaseEnabled: false,
      externalInternetAllowed: false,
      forbiddenTopics: ["aconselhamento jurídico"],
      humanRequiredTopics: ["documento pessoal", "fatura de energia"],
      dailyBudgetCents: 500,
      monthlyBudgetCents: 5000,
    });
    expect(renderAgentControlPolicy(cfg!)).toContain("Consulte a proposta.");
    expect(renderAgentControlPolicy(cfg!)).toContain("Não encontrei.");
  });

  it("identifica assunto obrigatório de humano sem diferenciar maiúsculas", () => {
    expect(matchesHandoffKeyword("Segue minha FATURA DE ENERGIA", ["fatura de energia"])).toBe(
      true,
    );
  });
});

describe("seleção de agente por conversa", () => {
  it("consulta escolha manual e regras automáticas e registra mudança efetiva", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            ...baseRow,
            selection_mode: "origin",
            selection_reason: "Regra automática: Tráfego pago",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    await loadPublishedAgentConfig({ query } as unknown as pg.Pool, "org1", "cs1", "conv1");
    expect(query.mock.calls[0]?.[0]).toContain("ai_agent_assignment_rules");
    expect(query.mock.calls[0]?.[1]).toEqual(["org1", "cs1", "conv1"]);
    expect(query.mock.calls[1]?.[0]).toContain("conversation_agent_events");
    expect(query.mock.calls[1]?.[1]).toEqual([
      "org1",
      "conv1",
      "a1",
      "origin",
      "Regra automática: Tráfego pago",
    ]);
  });
});
