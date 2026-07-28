import { z } from "zod";

const templateKindSchema = z.enum(["text", "poll"]);
const pollConfigSchema = z.object({
  options: z.array(z.string().trim().min(1).max(100)).min(2).max(12),
  multipleAnswers: z.boolean().default(false),
});

export const createTemplateSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(4096),
    shortcut: z.string().trim().min(1).max(40).optional(),
    /** true = compartilhado da org (owner null, exige manager+); false = pessoal. */
    shared: z.boolean().default(false),
    kind: templateKindSchema.default("text"),
    interactive_config: pollConfigSchema.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.kind === "poll" && !data.interactive_config) {
      ctx.addIssue({
        code: "custom",
        path: ["interactive_config"],
        message: "Informe as opções da enquete.",
      });
    }
  });
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(4096),
    shortcut: z.string().trim().min(1).max(40).nullable(),
    kind: templateKindSchema,
    interactive_config: pollConfigSchema.nullable(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "Informe ao menos um campo." });
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
