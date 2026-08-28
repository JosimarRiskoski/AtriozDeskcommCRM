import { describe, expect, it } from "vitest";

import { canRemoveChannel } from "@/lib/schemas/channels";

describe("canRemoveChannel", () => {
  it.each(["SCAN_QR_CODE", "STOPPED", "FAILED"])(
    "permite remover uma sessão sem transporte ativo (%s)",
    (status) => expect(canRemoveChannel(status)).toBe(true),
  );

  it.each(["STARTING", "WORKING"])(
    "protege uma sessão ativa ou iniciando (%s)",
    (status) => expect(canRemoveChannel(status)).toBe(false),
  );
});
