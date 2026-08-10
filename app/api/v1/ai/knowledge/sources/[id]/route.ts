/**
 * PATCH  /api/v1/ai/knowledge/sources/[id]  — update knowledge source
 * DELETE /api/v1/ai/knowledge/sources/[id]  — soft-delete (status='archived')
 *
 * Auth: cookie session. Role >= manager required.
 * organization_id is ALWAYS resolved from the authenticated session — never from body/path.
 */

import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseFaqMarkdown } from "@/lib/ai/rag/ingest/faq";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Zod schema for PATCH
// ---------------------------------------------------------------------------

const faqItemSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  tags: z.array(z.string()).optional().default([]),
  locale: z.string().optional().default("pt-BR"),
});

const patchSourceSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    items: z.array(faqItemSchema).optional(),
    markdown_blob: z.string().min(1).max(100_000).optional(),
    source_metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => value.items === undefined || value.markdown_blob === undefined, {
    message: "Envie items ou markdown_blob, não os dois.",
  });

// ---------------------------------------------------------------------------
// Shared: resolve auth + role gate
// ---------------------------------------------------------------------------

async function resolveContext(requestId: string) {
  const authz = await requireRole("manager", { requestId, resource: "ai_knowledge" });
  if (!authz.ok) return { error: authz.response };
  return { authUser: authz.user, activeOrg: authz.org };
}

// ---------------------------------------------------------------------------
// GET — detalhe da fonte + itens editáveis da FAQ
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: sourceId } = await params;

  const ctx = await resolveContext(requestId);
  if (ctx.error) return ctx.error;
  const { activeOrg } = ctx as Exclude<typeof ctx, { error: Response }>;

  const supabase = await createClient();
  const { data: source, error: sourceError } = await supabase
    .from("ai_knowledge_sources")
    .select("id, agent_id, source_type, name, source_metadata, status")
    .eq("id", sourceId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (sourceError) return fail("internal_error", "Erro ao buscar fonte.", 500, { requestId });
  if (!source)
    return fail("not_found", "Fonte de conhecimento não encontrada.", 404, { requestId });

  let items: Array<{
    id: string;
    question: string;
    answer: string;
    tags: string[];
    locale: string;
    position: number;
  }> = [];

  if (source.source_type === "faq") {
    const { data, error } = await supabase
      .from("ai_faq_items")
      .select("id, question, answer, tags, locale, position")
      .eq("knowledge_source_id", sourceId)
      .eq("organization_id", activeOrg.orgId)
      .order("position", { ascending: true });
    if (error) return fail("internal_error", "Erro ao buscar itens da FAQ.", 500, { requestId });
    items = (data ?? []) as typeof items;
  }

  return ok({ source, items }, { requestId });
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: sourceId } = await params;

  const ctx = await resolveContext(requestId);
  if (ctx.error) return ctx.error;
  const { activeOrg } = ctx as Exclude<typeof ctx, { error: Response }>;

  // Parse + validate body.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }

  const parsed = patchSourceSchema.safeParse(rawBody);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const input = parsed.data;

  // Verify the source exists and belongs to the org (user-scoped client for RLS check).
  const supabase = await createClient();
  const { data: existing, error: fetchErr } = await supabase
    .from("ai_knowledge_sources")
    .select("id, source_type, agent_id")
    .eq("id", sourceId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (fetchErr) {
    console.error("[ai-knowledge-sources] PATCH fetch failed:", fetchErr.message);
    return fail("internal_error", "Erro ao verificar fonte.", 500, { requestId });
  }
  if (!existing) {
    return fail("not_found", "Fonte de conhecimento não encontrada.", 404, { requestId });
  }

  const ksRow = existing as { id: string; source_type: string; agent_id: string };

  // Build update payload (only provided fields).
  const updatePayload: Record<string, unknown> = {};
  if (input.name !== undefined) updatePayload.name = input.name;
  if (input.source_metadata !== undefined) updatePayload.source_metadata = input.source_metadata;

  const admin = createAdminClient();

  if (Object.keys(updatePayload).length > 0) {
    const { error: updateErr } = await admin
      .from("ai_knowledge_sources")
      .update(updatePayload)
      .eq("id", sourceId)
      .eq("organization_id", activeOrg.orgId);

    if (updateErr) {
      console.error("[ai-knowledge-sources] PATCH update failed:", updateErr.message);
      return fail("internal_error", "Erro ao atualizar fonte.", 500, { requestId });
    }
  }

  // Replace FAQ items if provided as JSON or as the editor's markdown.
  let itemsCount: number | undefined;
  let nextItems = input.items;
  if (input.markdown_blob !== undefined) {
    if (ksRow.source_type !== "faq") {
      return fail("validation_failed", "markdown_blob é permitido somente para FAQ.", 422, {
        requestId,
      });
    }
    const parsedItems = parseFaqMarkdown(input.markdown_blob);
    if (parsedItems.length === 0) {
      return fail(
        "validation_failed",
        "Nenhuma pergunta válida encontrada. Use seções ## Pergunta: e ## Resposta:.",
        422,
        { requestId },
      );
    }
    nextItems = parsedItems;
  }

  if (nextItems !== undefined && ksRow.source_type === "faq") {
    // Delete existing items.
    const { error: delErr } = await admin
      .from("ai_faq_items")
      .delete()
      .eq("knowledge_source_id", sourceId)
      .eq("organization_id", activeOrg.orgId);

    if (delErr) {
      console.error("[ai-knowledge-sources] PATCH delete items failed:", delErr.message);
      return fail("internal_error", "Erro ao remover itens antigos.", 500, { requestId });
    }

    if (nextItems.length > 0) {
      const rows = nextItems.map((item, idx) => ({
        organization_id: activeOrg.orgId,
        knowledge_source_id: sourceId,
        question: item.question,
        answer: item.answer,
        tags: item.tags,
        locale: item.locale,
        position: idx,
      }));

      const { error: insertErr } = await admin.from("ai_faq_items").insert(rows);

      if (insertErr) {
        console.error("[ai-knowledge-sources] PATCH insert items failed:", insertErr.message);
        return fail("internal_error", "Erro ao inserir novos itens FAQ.", 500, { requestId });
      }
      itemsCount = rows.length;
    } else {
      itemsCount = 0;
    }
  }

  // Emit knowledge_source.updated (fire-and-forget).
  const { error: emitErr } = await admin.rpc(
    "emit_event" as never,
    {
      p_event_type: "knowledge_source.updated",
      p_entity_kind: "ai_knowledge_source",
      p_entity_id: sourceId,
      p_payload: {
        knowledge_source_id: sourceId,
        agent_id: ksRow.agent_id,
        source_type: ksRow.source_type,
      },
      p_organization_id: activeOrg.orgId,
    } as never,
  );

  if (emitErr) {
    console.warn("[ai-knowledge-sources] emit_event failed (non-blocking):", emitErr.message);
  }

  return ok(
    { id: sourceId, ...(itemsCount !== undefined ? { items_count: itemsCount } : {}) },
    { requestId },
  );
}

// ---------------------------------------------------------------------------
// DELETE — soft-delete (status='archived')
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: sourceId } = await params;

  const ctx = await resolveContext(requestId);
  if (ctx.error) return ctx.error;
  const { activeOrg } = ctx as Exclude<typeof ctx, { error: Response }>;

  // Verify ownership with user-scoped client.
  const supabase = await createClient();
  const { data: existing, error: fetchErr } = await supabase
    .from("ai_knowledge_sources")
    .select("id")
    .eq("id", sourceId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (fetchErr) {
    console.error("[ai-knowledge-sources] DELETE fetch failed:", fetchErr.message);
    return fail("internal_error", "Erro ao verificar fonte.", 500, { requestId });
  }
  if (!existing) {
    return fail("not_found", "Fonte de conhecimento não encontrada.", 404, { requestId });
  }

  const admin = createAdminClient();
  const { error: archiveErr } = await admin
    .from("ai_knowledge_sources")
    .update({ status: "archived" })
    .eq("id", sourceId)
    .eq("organization_id", activeOrg.orgId);

  if (archiveErr) {
    console.error("[ai-knowledge-sources] DELETE archive failed:", archiveErr.message);
    return fail("internal_error", "Erro ao arquivar fonte.", 500, { requestId });
  }

  return ok({ data: { id: sourceId, status: "archived" } }, { requestId });
}
