import { z } from "zod";

/**
 * Body para conectar um novo canal WhatsApp. `display_name` é opcional —
 * um rótulo amigável ("Vendas", "Suporte") que a Evolution complementa com o
 * nome do perfil quando a sessão fica WORKING.
 */
export const createChannelSchema = z.object({
  display_name: z.string().trim().min(2).max(80),
  purpose: z.string().trim().max(120).optional(),
  is_default: z.boolean().optional().default(false),
});

export const updateChannelSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    display_name: z.string().trim().min(2).max(80),
    purpose: z.string().trim().max(120).nullable().optional(),
    is_default: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("archive"),
    reason: z.string().trim().min(3).max(300),
  }),
  z.object({ action: z.literal("restore") }),
]);

export type CreateChannelInput = z.infer<typeof createChannelSchema>;

/** Status canônicos de conexão WhatsApp (Evolution + DB CHECK constraint). */
export const CHANNEL_STATUSES = [
  "STARTING",
  "SCAN_QR_CODE",
  "WORKING",
  "STOPPED",
  "FAILED",
] as const;

export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

export function isChannelStatus(v: string): v is ChannelStatus {
  return (CHANNEL_STATUSES as readonly string[]).includes(v);
}
