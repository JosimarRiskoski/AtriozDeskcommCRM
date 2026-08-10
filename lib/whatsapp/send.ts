import {
  evolutionRecipient,
  getEvolutionClient,
  parseEvolutionMessageId,
} from "@/lib/evolution/client";
export type WhatsAppProvider = "evolution";

export async function sendWhatsAppText(input: {
  provider: WhatsAppProvider;
  sessionName: string;
  chatId: string;
  text: string;
}): Promise<{ externalId: string | null } | null> {
  const evolution = getEvolutionClient();
  if (!evolution) return null;
  const result = await evolution.sendText(
    input.sessionName,
    evolutionRecipient(input.chatId),
    input.text,
  );
  return { externalId: parseEvolutionMessageId(result) };
}
