import { describe, expect, it } from "vitest";
import { activeSilence, conversationCommand } from "./conversation-command";

const now = new Date("2026-08-31T12:00:00.000Z");

describe("conversationCommand", () => {
  it("keeps Postgres infinity silenced", () => {
    expect(activeSilence("infinity", now)).toBe(true);
    expect(conversationCommand({ status: "open", assigned_to_user_id: null, bot_silenced_until: "infinity" }, now)).toBe("waiting");
  });

  it("classifies ownership before legacy status", () => {
    expect(conversationCommand({ status: "ai_handling", assigned_to_user_id: "user-1" }, now)).toBe("human");
    expect(conversationCommand({ status: "open", assigned_to_user_id: null }, now)).toBe("automatic");
  });

  it("keeps opt-out and handoff contacts in the human queue", () => {
    expect(conversationCommand({ status: "open", assigned_to_user_id: null, force_human: true }, now)).toBe("waiting");
    expect(conversationCommand({ status: "open", assigned_to_user_id: null, is_blocked: true }, now)).toBe("waiting");
  });
});
