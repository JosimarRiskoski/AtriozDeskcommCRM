import type { McpAuthResult } from "@/lib/mcp/auth";

/**
 * O agente só chega à ponte in-process com token efêmero, `actor:ai_agent` e
 * uma lista de ferramentas escolhida na versão publicada. Essa combinação é a
 * autorização explícita do administrador. Tokens MCP externos continuam
 * passando pelo servidor e pela hierarquia normal de papéis.
 */
export function isAuthorizedAgentToolCall(auth: Pick<McpAuthResult, "actor" | "scopes">): boolean {
  return (
    auth.actor.type === "ai_agent" &&
    auth.scopes.includes("actor:ai_agent") &&
    auth.scopes.includes("mcp:write") &&
    auth.scopes.some((scope) => scope.startsWith("agent_run:"))
  );
}
