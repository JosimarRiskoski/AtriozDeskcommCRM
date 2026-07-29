import { describe, expect, it } from "vitest";

import {
  DEFAULT_ORGANIZATION_PALETTE,
  isAppearancePalette,
  paletteTokens,
  readOrganizationPalette,
} from "./appearance";

describe("appearance", () => {
  it("accepts only supported palettes", () => {
    expect(isAppearancePalette("graphite-blue")).toBe(true);
    expect(isAppearancePalette("olive")).toBe(true);
    expect(isAppearancePalette("custom-script")).toBe(false);
  });

  it("reads the organization palette with a safe default", () => {
    expect(readOrganizationPalette({ appearance: { palette: "plum" } })).toBe("plum");
    expect(readOrganizationPalette({ appearance: { palette: "invalid" } })).toBe(
      DEFAULT_ORGANIZATION_PALETTE,
    );
    expect(readOrganizationPalette(null)).toBe(DEFAULT_ORGANIZATION_PALETTE);
  });

  it("keeps semantic state colors separate from the accent", () => {
    const tokens = paletteTokens("graphite-indigo", "dark");
    expect(tokens.accent).not.toBe(tokens.states.success);
    expect(tokens.states.error).not.toBe(tokens.states.warning);
  });
});
