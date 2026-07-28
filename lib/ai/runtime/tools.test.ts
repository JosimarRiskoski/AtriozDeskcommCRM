import { describe, expect, it } from "vitest";

import { isAuthorizedAgentToolCall } from "./tool-authorization";

describe("isAuthorizedAgentToolCall", () => {
  it("autoriza somente o token efêmero completo do agente", () => {
    expect(
      isAuthorizedAgentToolCall({
        actor: { type: "ai_agent", id: "run-1", role: "agent" },
        scopes: ["mcp:read", "mcp:write", "actor:ai_agent", "agent_run:run-1"],
      }),
    ).toBe(true);
  });

  it.each([
    {
      actor: { type: "user" as const, id: "token-1", role: "manager" as const },
      scopes: ["mcp:write", "actor:ai_agent", "agent_run:run-1"],
    },
    {
      actor: { type: "ai_agent" as const, id: "run-1", role: "agent" as const },
      scopes: ["mcp:write", "actor:ai_agent"],
    },
    {
      actor: { type: "ai_agent" as const, id: "run-1", role: "agent" as const },
      scopes: ["mcp:read", "actor:ai_agent", "agent_run:run-1"],
    },
  ])("não amplia permissão de token externo ou incompleto", (auth) => {
    expect(isAuthorizedAgentToolCall(auth)).toBe(false);
  });
});
