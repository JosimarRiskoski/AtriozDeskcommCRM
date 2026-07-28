import { describe, expect, it } from "vitest";

import { createTemplateSchema } from "./templates";

describe("createTemplateSchema", () => {
  it("keeps ordinary templates as text", () => {
    const parsed = createTemplateSchema.parse({ title: "Olá", body: "Olá {{primeiro_nome}}" });
    expect(parsed.kind).toBe("text");
  });

  it("accepts a poll with two or more options", () => {
    const parsed = createTemplateSchema.safeParse({
      title: "Escolha",
      body: "Qual horário você prefere?",
      kind: "poll",
      interactive_config: { options: ["Manhã", "Tarde"], multipleAnswers: false },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a poll without its options", () => {
    expect(
      createTemplateSchema.safeParse({ title: "Escolha", body: "Qual?", kind: "poll" }).success,
    ).toBe(false);
  });
});
