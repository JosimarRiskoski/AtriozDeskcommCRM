import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureRole: vi.fn(() => {
    throw new Error("role_forbidden");
  }),
  ensureScope: vi.fn(),
  handler: vi.fn(async () => ({ updated: true })),
}));

vi.mock("@/lib/mcp/audit", () => ({ auditMcpToolCall: vi.fn() }));
vi.mock("@/lib/mcp/auth", () => ({
  ensureRole: mocks.ensureRole,
  ensureScope: mocks.ensureScope,
}));
vi.mock("@/lib/mcp/tools", () => {
  const definition = {
    name: "crm_update_contact",
    description: "Atualiza contato",
    inputSchema: {},
    category: "write",
    requiresRole: "manager",
    requiresScope: "mcp:write",
    handler: mocks.handler,
  };
  return {
    allTools: [definition],
    getToolByName: (name: string) => (name === definition.name ? definition : undefined),
  };
});

import { pickToolsFromMcp } from "./tools";

describe("ponte MCP do agente", () => {
  it("executa uma escrita selecionada sem ampliar tokens MCP externos", async () => {
    const tools = pickToolsFromMcp({
      supabase: {} as never,
      ctx: {
        organizationId: "org-1",
        role: "agent",
        actor: { type: "ai_agent", id: "run-1", role: "agent" },
        apiTokenId: "token-1",
        requestId: "run-1",
        supabase: {} as never,
      },
      auth: {
        organizationId: "org-1",
        role: "agent",
        actor: { type: "ai_agent", id: "run-1", role: "agent" },
        apiTokenId: "token-1",
        scopes: ["mcp:read", "mcp:write", "actor:ai_agent", "agent_run:run-1"],
      },
      toolIds: ["crm_update_contact"],
      handoffToolEnabled: false,
      handoffSignal: { triggered: false },
    });

    const execute = (
      tools.crm_update_contact as unknown as {
        execute: (args: unknown, options: unknown) => Promise<unknown>;
      }
    ).execute;
    await expect(execute({}, {})).resolves.toEqual({ updated: true });
    expect(mocks.ensureScope).toHaveBeenCalledWith(expect.any(Array), "mcp:write");
    expect(mocks.ensureRole).not.toHaveBeenCalled();
    expect(mocks.handler).toHaveBeenCalledTimes(1);
  });
});
