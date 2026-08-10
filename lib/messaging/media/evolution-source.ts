/**
 * A Evolution entrega mídia em base64 no webhook quando `webhookBase64=true`.
 * Aceitamos apenas data URLs, sem buscar URL indicada no payload: isso evita
 * SSRF e permite persistir a mídia no bucket privado do CRM.
 */
import {
  MAX_MEDIA_BYTES,
  MediaTooLargeError,
  type FetchedMedia,
} from "@/lib/messaging/media/types";
import { validateOutboundMedia } from "@/lib/messaging/media/upload-validation";

export async function fetchEvolutionMedia(
  mediaUrl: string,
  hintMime?: string | null,
): Promise<FetchedMedia> {
  const match = /^data:([^,]*);base64,([a-z0-9+/=\s]*)$/i.exec(mediaUrl);
  if (!match) throw new Error("evolution_media_invalid_data_url");
  const buffer = Buffer.from((match[2] ?? "").replace(/\s/g, ""), "base64");
  if (buffer.byteLength > MAX_MEDIA_BYTES) throw new MediaTooLargeError();
  const mime = (match[1] || hintMime || "application/octet-stream").split(";")[0]!.trim();
  const validation = validateOutboundMedia(mime, buffer.byteLength);
  if (!validation.ok) throw new Error(`evolution_media_${validation.code}`);
  return { buffer, mime: mime.split(";")[0]!.trim().toLowerCase() };
}
