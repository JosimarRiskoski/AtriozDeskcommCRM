export type ConversationCommand = "human" | "automatic" | "waiting" | "finished";

export interface ConversationCommandFacts {
  status: string;
  assigned_to_user_id: string | null;
  bot_silenced_until?: string | null;
  force_human?: boolean | null;
  is_blocked?: boolean | null;
}

const FINISHED_STATUSES = new Set(["closed", "archived", "resolved"]);

export function activeSilence(value: string | null | undefined, now = new Date()): boolean {
  if (!value || value === "-infinity") return false;
  if (value === "infinity") return true;
  const until = new Date(value);
  // Fail closed: an unreadable persisted value must never wake the bot.
  return Number.isNaN(until.getTime()) || until.getTime() > now.getTime();
}

export function conversationCommand(
  facts: ConversationCommandFacts,
  now = new Date(),
): ConversationCommand {
  if (facts.assigned_to_user_id) return "human";
  if (FINISHED_STATUSES.has(facts.status)) return "finished";
  if (
    facts.force_human === true ||
    facts.is_blocked === true ||
    activeSilence(facts.bot_silenced_until, now)
  ) {
    return "waiting";
  }
  return "automatic";
}
