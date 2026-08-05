import {
  evolutionRecipient,
  getEvolutionClient,
  parseEvolutionMessageId,
} from "@/lib/evolution/client";
import { sendWAHA } from "@/lib/waha/send";

export type WhatsAppProvider = "waha" | "evolution";

export async function sendWhatsAppText(input: {
  provider: WhatsAppProvider;
  sessionName: string;
  chatId: string;
  text: string;
}): Promise<{ externalId: string | null } | null> {
  if (input.provider === "evolution") {
    const evolution = getEvolutionClient();
    if (!evolution) return null;
    const result = await evolution.sendText(
      input.sessionName,
      evolutionRecipient(input.chatId),
      input.text,
    );
    return { externalId: parseEvolutionMessageId(result) };
  }
  const result = await sendWAHA({
    sessionName: input.sessionName,
    chatId: input.chatId,
    text: input.text,
  });
  return result ? { externalId: null } : null;
}
