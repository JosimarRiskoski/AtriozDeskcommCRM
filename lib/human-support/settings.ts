import { z } from "zod";

const groupId = z
  .string()
  .trim()
  .regex(/^\d+(?:-\d+)?@g\.us$/, "Informe um identificador de grupo válido (@g.us).");

export const humanSupportSettingsSchema = z
  .object({
    first_alert_minutes: z.coerce.number().int().min(1).max(1440).default(5),
    escalation_minutes: z.coerce.number().int().min(1).max(10080).default(30),
    repeat_alert_minutes: z.coerce.number().int().min(5).max(10080).default(30),
    max_alert_repeats: z.coerce.number().int().min(0).max(20).default(3),
    close_alert_on_resolution: z.boolean().default(true),
    timezone: z.string().trim().min(1).max(100).default("America/Sao_Paulo"),
    business_hours: z
      .object({
        enabled: z.boolean().default(false),
        windows: z
          .array(
            z.object({ dow: z.number().int().min(0).max(6), start: z.string(), end: z.string() }),
          )
          .default([]),
      })
      .default({ enabled: false, windows: [] }),
    notify_in_app: z.boolean().default(true),
    notify_email: z.boolean().default(false),
    notify_whatsapp_group: z.boolean().default(false),
    whatsapp_connection_id: z.string().uuid().nullable().default(null),
    whatsapp_group_chat_id: groupId.nullable().default(null),
    whatsapp_group_name: z.string().trim().max(120).nullable().default(null),
    group_phone_display: z.enum(["masked", "full"]).default("masked"),
    group_notify_handoffs: z.boolean().default(true),
    group_notify_crm_errors: z.boolean().default(true),
    group_notify_connection_down: z.boolean().default(true),
    group_notify_ai_budget: z.boolean().default(true),
    group_notify_campaign_paused: z.boolean().default(true),
    allow_group_replies: z.boolean().default(false),
    authorized_manager_phones: z
      .array(
        z
          .string()
          .transform((v) => v.replace(/\D/g, ""))
          .pipe(z.string().min(10).max(15)),
      )
      .default([]),
    group_message_template: z
      .string()
      .trim()
      .min(10)
      .max(2000)
      .default(
        "NOVO CASO HUMANO\nContato: {{contact_name}}\nTelefone: {{contact_phone}}\nResumo: {{summary}}\nUrgência: {{urgency}}\nResponsável: {{assignee_name}}\nAbrir no CRM: {{crm_link}}\nCaso: {{case_id}}",
      ),
    handoff_rules: z
      .object({
        customer_request: z.boolean().default(true),
        low_confidence: z.boolean().default(true),
        missing_information: z.boolean().default(true),
        repeated_failure: z.boolean().default(true),
        complaint_or_risk: z.boolean().default(true),
        calculation: z.boolean().default(true),
        commercial_exception: z.boolean().default(true),
        document_review: z.boolean().default(true),
        tool_unavailable: z.boolean().default(true),
        required_document_types: z
          .array(z.string().trim().min(1).max(100))
          .default(["documento pessoal", "fatura de energia"]),
        custom_intents: z.array(z.string().trim().min(1).max(100)).default([]),
      })
      .default({
        customer_request: true,
        low_confidence: true,
        missing_information: true,
        repeated_failure: true,
        complaint_or_risk: true,
        calculation: true,
        commercial_exception: true,
        document_review: true,
        tool_unavailable: true,
        required_document_types: ["documento pessoal", "fatura de energia"],
        custom_intents: [],
      }),
  })
  .superRefine((value, ctx) => {
    if (value.escalation_minutes <= value.first_alert_minutes)
      ctx.addIssue({
        code: "custom",
        path: ["escalation_minutes"],
        message: "A escalada deve acontecer depois do primeiro alerta.",
      });
    if (
      value.notify_whatsapp_group &&
      (!value.whatsapp_connection_id || !value.whatsapp_group_chat_id)
    )
      ctx.addIssue({
        code: "custom",
        path: ["whatsapp_group_chat_id"],
        message: "Escolha a conexão e o grupo antes de ativar avisos no WhatsApp.",
      });
    if (value.allow_group_replies && value.authorized_manager_phones.length === 0)
      ctx.addIssue({
        code: "custom",
        path: ["authorized_manager_phones"],
        message: "Cadastre ao menos um gestor autorizado para comandos no grupo.",
      });
  });

export const DEFAULT_HUMAN_SUPPORT_SETTINGS = humanSupportSettingsSchema.parse({});
export type HumanSupportSettings = z.infer<typeof humanSupportSettingsSchema>;
