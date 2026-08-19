import { describe, expect, it } from "vitest";

import { fetchEvolutionMedia } from "@/lib/messaging/media/evolution-source";
import { MAX_MEDIA_BYTES, MediaTooLargeError } from "@/lib/messaging/media/types";

function dataUrl(mime: string, bytes = Buffer.from([1, 2, 3])): string {
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

describe("fetchEvolutionMedia", () => {
  it.each(["audio/ogg", "audio/webm", "audio/mpeg"])(
    "aceita o formato de áudio %s entregue pela Evolution",
    async (mime) => {
      const result = await fetchEvolutionMedia(dataUrl(mime));
      expect(result.mime).toBe(mime);
      expect(result.buffer).toEqual(Buffer.from([1, 2, 3]));
    },
  );

  it("normaliza MIME com codec", async () => {
    const result = await fetchEvolutionMedia(dataUrl("audio/ogg;codecs=opus"));
    expect(result.mime).toBe("audio/ogg");
  });

  it("aceita a variante ZIP usada por clientes Windows", async () => {
    const result = await fetchEvolutionMedia(dataUrl("application/x-zip-compressed"));
    expect(result.mime).toBe("application/x-zip-compressed");
  });

  it("recusa formato sem suporte", async () => {
    await expect(fetchEvolutionMedia(dataUrl("application/x-executable"))).rejects.toThrow(
      "evolution_media_unsupported_media_type",
    );
  });

  it("recusa arquivo vazio", async () => {
    await expect(fetchEvolutionMedia(dataUrl("audio/ogg", Buffer.alloc(0)))).rejects.toThrow(
      "evolution_media_validation_failed",
    );
  });

  it("recusa arquivo acima do limite", async () => {
    const oversized = Buffer.alloc(MAX_MEDIA_BYTES + 1, 1);
    await expect(fetchEvolutionMedia(dataUrl("audio/ogg", oversized))).rejects.toBeInstanceOf(
      MediaTooLargeError,
    );
  });
});
