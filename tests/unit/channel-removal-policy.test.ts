import { describe, expect, it } from "vitest";

import { canRemoveChannel } from "@/lib/schemas/channels";

describe("canRemoveChannel", () => {
  it.each(["STARTING", "SCAN_QR_CODE", "STOPPED", "FAILED"])(
    "permite remover uma sessão sem transporte ativo (%s)",
    (status) => expect(canRemoveChannel(status)).toBe(true),
  );

  it.each(["WORKING"])(
    "protege uma sessão com transporte WhatsApp ativo (%s)",
    (status) => expect(canRemoveChannel(status)).toBe(false),
  );
});
