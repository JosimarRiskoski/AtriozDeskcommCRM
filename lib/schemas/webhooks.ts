/**
 * Zod schemas for webhook-sources e automation-rules (feature Webhooks, Task 12).
 * TRIGGER_EVENTS deve espelhar exatamente os 5 eventos que o motor
 * (`lib/automation/engine.ts` → EXPECTED_ENTITY_KIND) reconhece.
 */
import { z } from "zod";

export const TRIGGER_EVENTS = [
  "lead.created",
  "lead.stage_changed",
  "message.received",
  "lead.tag_added",
  "contact.tag_added",
] as const;

export const conditionSchema = z.object({
  field: z.string().min(1).max(200),
  op: z.enum(["eq", "neq", "contains"]),
  value: z.string().max(500),
});

export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_or_move_lead"),
    config: z.object({ pipeline_id: z.string().uuid(), stage_id: z.string().uuid() }),
  }),
  z.object({
    type: z.literal("send_whatsapp_message"),
    config: z.object({
      channel_session_id: z.string().uuid(),
      template: z.string().min(1).max(2000),
    }),
  }),
  z.object({
    type: z.literal("add_tag"),
    config: z.object({ tags: z.array(z.string().min(1).max(60)).min(1).max(10) }),
  }),
  z.object({ type: z.literal("assign_owner"), config: z.object({ user_id: z.string().uuid() }) }),
  z.object({
    type: z.literal("call_webhook"),
    config: z.object({
      url: z.string().url().max(2000),
      // Input do usuário (plaintext, write-only) — a rota troca por secret_enc.
      secret: z.string().max(200).optional(),
      // Ciphertext hex (round-trip do editor: GET devolve, PATCH preserva).
      secret_enc: z.string().max(4000).optional(),
    }),
  }),
]);

const webhookSourceFields = z.object({
  name: z.string().min(1).max(120),
  provider_type: z.enum(["generic", "3c", "paid_traffic"]).default("generic"),
  source_code: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/)
    .default("webhook"),
  require_external_id: z.boolean().default(false),
  create_opportunity: z.boolean().default(true),
  default_pipeline_id: z.string().uuid().nullable().optional(),
  default_stage_id: z.string().uuid().nullable().optional(),
  default_channel_session_id: z.string().uuid().nullable().optional(),
  default_agent_id: z.string().uuid().nullable().optional(),
  activate_ai: z.boolean().default(false),
  followup_flow_id: z.string().uuid().nullable().optional(),
  automation_enabled: z.boolean().default(false),
  automation_external_state_field: z.string().trim().max(120).nullable().optional(),
  redirect_to: z.string().url().max(2000).nullish(),
  field_map: z
    .object({
      name: z.array(z.string()).optional(),
      phone: z.array(z.string()).optional(),
      email: z.array(z.string()).optional(),
    })
    .optional(),
  secret: z.string().min(16).max(200).nullish(),
});

export const createWebhookSourceSchema = webhookSourceFields.superRefine((value, context) => {
  if (value.create_opportunity && (!value.default_pipeline_id || !value.default_stage_id)) {
    context.addIssue({
      code: "custom",
      message: "Escolha o funil e a etapa.",
      path: ["default_pipeline_id"],
    });
  }
  if (value.provider_type === "3c" && (!value.require_external_id || !value.secret)) {
    context.addIssue({
      code: "custom",
      message: "A integração 3C exige identificador externo e segredo.",
      path: ["secret"],
    });
  }
  if (value.automation_enabled) {
    context.addIssue({
      code: "custom",
      message: "A automação nasce desligada e só pode ser ativada após o piloto.",
      path: ["automation_enabled"],
    });
  }
  if ((value.activate_ai || value.followup_flow_id) && !value.default_channel_session_id) {
    context.addIssue({
      code: "custom",
      message: "Escolha uma conexão para IA ou cadência.",
      path: ["default_channel_session_id"],
    });
  }
});
export const updateWebhookSourceSchema = webhookSourceFields.partial().extend({
  is_active: z.boolean().optional(),
});

export const createAutomationRuleSchema = z.object({
  name: z.string().min(1).max(120),
  trigger_event: z.enum(TRIGGER_EVENTS),
  conditions: z.array(conditionSchema).max(10).default([]),
  actions: z.array(actionSchema).min(1).max(10),
});
export const updateAutomationRuleSchema = createAutomationRuleSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type CreateWebhookSourceInput = z.infer<typeof createWebhookSourceSchema>;
export type UpdateWebhookSourceInput = z.infer<typeof updateWebhookSourceSchema>;
export type CreateAutomationRuleInput = z.infer<typeof createAutomationRuleSchema>;
export type UpdateAutomationRuleInput = z.infer<typeof updateAutomationRuleSchema>;
