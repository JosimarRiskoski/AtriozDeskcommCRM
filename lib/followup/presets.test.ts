import { describe, expect, it } from "vitest";

import { flowGraphSchema } from "./graph-schema";
import { buildFollowupPresetGraph, FOLLOWUP_PRESETS, isFollowupPresetId } from "./presets";
import { validateFlowForPublish } from "./validate-publish";

describe("follow-up presets", () => {
  it("builds a schema-valid graph for every preset", () => {
    for (const preset of FOLLOWUP_PRESETS) {
      expect(flowGraphSchema.safeParse(buildFollowupPresetGraph(preset.id)).success).toBe(true);
    }
  });

  it("builds publishable ready-made presets", () => {
    for (const preset of FOLLOWUP_PRESETS.filter((item) => item.id !== "blank")) {
      const validation = validateFlowForPublish(buildFollowupPresetGraph(preset.id));
      expect(validation.ok, preset.id).toBe(true);
    }
  });

  it("recognizes only supported ids", () => {
    expect(isFollowupPresetId("proposal")).toBe(true);
    expect(isFollowupPresetId("drop_database")).toBe(false);
  });
});
