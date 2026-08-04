import { describe, expect, it } from "vitest";
import { DEFAULT_HUMAN_SUPPORT_SETTINGS, humanSupportSettingsSchema } from "./settings";
import { parseManagerGroupCommand } from "./group-command-parser";

describe("human support settings", () => {
  it("starts with the current niche document rules but keeps them configurable", () => {
    expect(DEFAULT_HUMAN_SUPPORT_SETTINGS.handoff_rules.required_document_types).toEqual([
      "documento pessoal",
      "fatura de energia",
    ]);
  });

  it("requires group and connection before WhatsApp alerts", () => {
    const result = humanSupportSettingsSchema.safeParse({ notify_whatsapp_group: true });
    expect(result.success).toBe(false);
  });

  it("requires an authorized manager when group commands are enabled", () => {
    const result = humanSupportSettingsSchema.safeParse({ allow_group_replies: true });
    expect(result.success).toBe(false);
  });
});

describe("manager group commands", () => {
  it("accepts only a delimited case command", () => {
    expect(parseManagerGroupCommand("vou responder esse cliente")).toBeNull();
    expect(
      parseManagerGroupCommand(
        "CASO 123e4567-e89b-12d3-a456-426614174000 RESOLVER Pode prosseguir",
      ),
    ).toEqual({
      caseId: "123e4567-e89b-12d3-a456-426614174000",
      action: "RESOLVER",
      body: "Pode prosseguir",
    });
  });
});
