import { describe, expect, it } from "vitest";
import { brlInputToCents, formatBrlInput } from "@/lib/formatters/brl-input";

describe("formatBrlInput", () => {
  it("exibe separador de milhar durante a digitação e preserva o valor", () => {
    expect(formatBrlInput("35000")).toBe("35.000");
    expect(formatBrlInput("35000,9")).toBe("35.000,9");
    expect(brlInputToCents("35.000,90")).toBe(3_500_090);
  });
});
