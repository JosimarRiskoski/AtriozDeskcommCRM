import { describe, expect, it } from "vitest";
import {
  classifyFailure,
  failureRecommendation,
  understandableFailure,
} from "./failure-presentation";

describe("failure presentation", () => {
  it.each([
    ["campaign_channel_not_working", "conexao"],
    ["number_not_on_whatsapp", "telefone"],
    ["contact_blocked", "consentimento_bloqueio"],
    ["audio_copy_failed", "midia_documento"],
    ["ai_gateway_timeout", "timeout"],
    ["webhook_signature", "integracao"],
  ])("classifica %s", (code, expected) =>
    expect(classifyFailure(code, null, "CRM")).toBe(expected),
  );

  it("traduz código cru e oferece ação", () => {
    const category = classifyFailure("number_not_on_whatsapp", null, "Campanhas");
    expect(understandableFailure(category, "number_not_on_whatsapp")).toContain("telefone");
    expect(failureRecommendation(category)).toContain("número");
  });
});
