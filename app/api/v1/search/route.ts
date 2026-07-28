import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().min(2).max(80),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

function cleanTerm(value: string): string {
  // PostgREST usa vírgulas e parênteses para compor filtros. Removê-los evita
  // que texto digitado na busca seja interpretado como parte da expressão.
  return value.replace(/[,()%]/g, " ").replace(/\s+/g, " ").trim();
}

export interface GlobalSearchPayload {
  contacts: Array<{
    id: string;
    title: string;
    description: string;
  }>;
  conversations: Array<{
    id: string;
    title: string;
    description: string;
  }>;
  leads: Array<{
    id: string;
    pipeline_id: string;
    title: string;
    description: string;
  }>;
  files: Array<{
    id: string;
    conversation_id: string;
    title: string;
    description: string;
  }>;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "global_search" });
  if (!authz.ok) return authz.response;

  const parsed = querySchema.safeParse({
    q: new URL(req.url).searchParams.get("q") ?? "",
    limit: new URL(req.url).searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return fail("validation_failed", "Digite pelo menos dois caracteres.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const cleaned = cleanTerm(parsed.data.q);
  if (cleaned.length < 2) {
    return fail("validation_failed", "Use pelo menos dois caracteres pesquisáveis.", 422, {
      requestId,
    });
  }

  const admin = createAdminClient();
  const orgId = authz.org.orgId;
  const like = `%${cleaned}%`;
  const limit = parsed.data.limit;

  const [contactsResult, conversationsResult, leadsResult, filesResult] = await Promise.all([
    admin
      .from("contacts")
      .select("id, name, display_name, phone_number, email, company")
      .eq("organization_id", orgId)
      .is("is_merged_into", null)
      .or(`name.ilike.${like},display_name.ilike.${like},phone_number.ilike.${like},email.ilike.${like},company.ilike.${like}`)
      .limit(limit),
    admin
      .from("conversations")
      .select("id, channel, status, last_message_preview, last_message_at")
      .eq("organization_id", orgId)
      .ilike("last_message_preview", like)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(limit),
    admin
      .from("crm_leads")
      .select("id, pipeline_id, title, description, status")
      .eq("organization_id", orgId)
      .or(`title.ilike.${like},description.ilike.${like}`)
      .order("updated_at", { ascending: false })
      .limit(limit),
    admin
      .from("messages")
      .select("id, conversation_id, body, media_derived_text, media_mime, sent_at")
      .eq("organization_id", orgId)
      .not("media_storage_path", "is", null)
      .or(`body.ilike.${like},media_derived_text.ilike.${like},media_mime.ilike.${like}`)
      .order("sent_at", { ascending: false })
      .limit(limit),
  ]);

  const firstError = [contactsResult.error, conversationsResult.error, leadsResult.error, filesResult.error]
    .find(Boolean);
  if (firstError) {
    return fail("internal_error", "Não foi possível concluir a busca global.", 500, {
      requestId,
    });
  }

  const payload: GlobalSearchPayload = {
    contacts: (contactsResult.data ?? []).map((contact) => ({
      id: contact.id,
      title: contact.display_name || contact.name || contact.phone_number || "Contato sem nome",
      description: [contact.phone_number, contact.email, contact.company].filter(Boolean).join(" · ") || "Contato",
    })),
    conversations: (conversationsResult.data ?? []).map((conversation) => ({
      id: conversation.id,
      title: conversation.last_message_preview || "Conversa sem prévia",
      description: `${conversation.channel} · ${conversation.status}`,
    })),
    leads: (leadsResult.data ?? []).map((lead) => ({
      id: lead.id,
      pipeline_id: lead.pipeline_id,
      title: lead.title,
      description: lead.description || `Negócio ${lead.status}`,
    })),
    files: (filesResult.data ?? []).map((file) => ({
      id: file.id,
      conversation_id: file.conversation_id,
      title: file.body || file.media_derived_text || "Arquivo da conversa",
      description: file.media_mime || "Arquivo",
    })),
  };

  return ok(payload, { requestId });
}
