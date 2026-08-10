import { getEvolutionClient } from "@/lib/evolution/client";
import { fetchEvolutionMedia } from "@/lib/messaging/media/evolution-source";
import type { FetchedMedia } from "@/lib/messaging/media/types";

interface EvolutionMediaInput {
  mediaUrl: string | null;
  hintMime?: string | null;
  instanceName: string;
  message: Record<string, unknown>;
}

export async function fetchEvolutionMessageMedia(
  input: EvolutionMediaInput,
): Promise<FetchedMedia> {
  if (input.mediaUrl?.startsWith("data:")) {
    return fetchEvolutionMedia(input.mediaUrl, input.hintMime);
  }
  const client = getEvolutionClient();
  if (!client) throw new Error("evolution_not_configured");
  if (!Object.keys(input.message).length) throw new Error("evolution_media_message_missing");
  const result = await client.getBase64FromMediaMessage(input.instanceName, input.message);
  const mime = result.mimetype || input.hintMime || "application/octet-stream";
  return fetchEvolutionMedia(`data:${mime};base64,${result.base64}`, mime);
}
