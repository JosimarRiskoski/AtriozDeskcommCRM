import { describe, expect, it } from "vitest";

import {
  channelColor,
  channelColorStyles,
  channelDisplayLabel,
  DEFAULT_CHANNEL_COLOR,
} from "@/lib/channels/display";
import { createChannelSchema, updateChannelSchema } from "@/lib/schemas/channels";

describe("identidade visual das conexões", () => {
  it("normaliza cores válidas e rejeita valores que não sejam hexadecimal", () => {
    expect(
      createChannelSchema.parse({ display_name: "Comercial", display_color: "#a855f7" })
        .display_color,
    ).toBe("#A855F7");
    expect(
      updateChannelSchema.safeParse({
        action: "update",
        display_name: "Comercial",
        display_color: "purple",
      }).success,
    ).toBe(false);
  });

  it("usa uma cor segura quando registros antigos não possuem uma cor válida", () => {
    expect(channelColor(null)).toBe(DEFAULT_CHANNEL_COLOR);
    expect(channelColor("#10b981")).toBe("#10B981");
    expect(channelColorStyles("#10B981")).toEqual({
      borderColor: "#10B98180",
      color: "#10B981",
      backgroundColor: "#10B98118",
    });
  });

  it("monta um rótulo mesmo quando o nome amigável não foi preenchido", () => {
    expect(channelDisplayLabel({ display_name: "Vendas" })).toBe("Vendas");
    expect(channelDisplayLabel({ phone_number: "+5547999999999" })).toBe("+5547999999999");
    expect(channelDisplayLabel({ external_session_name: "instancia-1" })).toBe("instancia-1");
  });
});
