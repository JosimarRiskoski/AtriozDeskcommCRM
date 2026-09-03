import { z } from "zod";

export const channelColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Escolha uma cor válida.")
  .transform((value) => value.toUpperCase());

/**
 * Body para conectar um novo canal WhatsApp. `display_name` é opcional —
 * um rótulo amigável ("Vendas", "Suporte") que a Evolution complementa com o
 * nome do perfil quando a sessão fica WORKING.
 */
export const createChannelSchema = z.object({
  display_name: z.string().trim().min(2).max(80),
  purpose: z.string().trim().max(120).optional(),
  is_default: z.boolean().optional().default(false),
  display_color: channelColorSchema.optional(),
});

export const updateChannelSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    display_name: z.string().trim().min(2).max(80),
    purpose: z.string().trim().max(120).nullable().optional(),
    is_default: z.boolean().optional(),
    display_color: channelColorSchema.optional(),
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

/**
 * Só uma sessão com transporte WhatsApp efetivamente ativo precisa ser
 * protegida contra remoção. STARTING e SCAN_QR_CODE ainda não podem atender
 * nem enviar; bloqueá-las prendia no CRM números que nem chegaram a conectar.
 */
export function canRemoveChannel(status: string): boolean {
  return status !== "WORKING";
}
