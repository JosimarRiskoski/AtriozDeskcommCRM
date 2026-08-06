import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("roteamento da credencial publicada nas chamadas auxiliares", () => {
  it("propaga a credencial do agente selecionado em todo o turno inbound", () => {
    const source = read("lib/agent-engine/agent/inbound-turn.ts");

    expect(source).toContain("const agentLlmOverride =");
    expect(source.match(/llmOverride: agentLlmOverride/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it.each([
    "lib/agent-engine/agent/stage-classifier.ts",
    "lib/agent-engine/agent/compaction.ts",
    "lib/agent-engine/guardrails/jailbreak/classifier.ts",
    "lib/agent-engine/guardrails/promise/semantic.ts",
  ])("%s encaminha llmOverride ao runModelCall", (path) => {
    const source = read(path);

    expect(source).toContain("llmOverride?: LlmResolveOverride");
    expect(source).toContain("{ llmOverride: deps.llmOverride }");
  });
});
