/**
 * RAG indexer worker — consumes domain events and indexes content into
 * `ai_chunks` + `ai_knowledge_versions` for semantic retrieval.
 *
 * Events handled:
 *   - nuvemshop.product_synced  → fetches product, embeds chunks, activates version
 *   - knowledge_source.updated  → reconstrói e ativa uma versão com conteúdo real
 *
 * Service-role caveat (CLAUDE.md §multi-tenancy): every query filters
 * `organization_id` from the trusted event row, never from user input.
 */

import { embedText } from "@/lib/ai/embed";
import { acquireDebounce } from "@/lib/ai/rag/debounce";
import { chunkText, computeContentHash } from "@/lib/ai/rag/chunker";
import { estimateTokens } from "@/lib/ai/runtime/history";
import { formatProductForRag, type NuvemshopProduct } from "@/lib/ai/rag/format-product";
import { ingestPolicyFile } from "@/lib/ai/rag/ingest/policy";
import {
  createKnowledgeVersion,
  markVersionReady,
  markVersionFailed,
  activateVersion,
} from "@/lib/ai/rag/version";
import type { EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";
import { NuvemshopApiClient } from "@/lib/nuvemshop/api-client";

const DEBOUNCE_TTL_SEC = 30;
const LAG_WARN_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SkipResult = { type: "skip"; reason: string };
type ErrorResult = { type: "error"; detail: string };
type OkResult = { type: "ok"; versionId: string; chunkCount: number };
type ProcessResult = SkipResult | ErrorResult | OkResult;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function skip(reason: string): SkipResult {
  return { type: "skip", reason };
}

/**
 * Loads the default active agent for the org.
 * Returns null when no agent is configured.
 */
async function resolveAgent(
  organizationId: string,
  preferredAgentId?: string,
): Promise<{ id: string; active_kb_version_id: string | null } | null> {
  const admin = createAdminClient();
  let query = admin
    .from("ai_agents")
    .select("id, organization_id, active_kb_version_id, is_active, is_default")
    .eq("organization_id", organizationId);

  // Um evento de conhecimento aponta para um agente específico e deve poder
  // preparar sua base mesmo quando ele está pausado. `is_active` controla se o
  // agente responde clientes; não deve bloquear edição, teste ou indexação.
  if (preferredAgentId) {
    query = query.eq("id", preferredAgentId);
  } else {
    query = query.eq("is_active", true);
  }
  const { data } = await query
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    id: (data as { id: string }).id,
    active_kb_version_id:
      (data as { active_kb_version_id: string | null }).active_kb_version_id ?? null,
  };
}

/**
 * Loads the decrypted Nuvemshop access token + store ID for the org.
 * Returns null when the integration is not connected.
 */
async function resolveNuvemshopCredentials(
  organizationId: string,
): Promise<{ accessToken: string; storeId: string } | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("tenant_integrations")
    .select("id, organization_id, provider, store_metadata, oauth_access_token_encrypted")
    .eq("organization_id", organizationId)
    .eq("provider", "nuvemshop")
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) return null;

  // store_metadata carries the storeId as { store_id: string } or { id: number }
  const meta = (data as { store_metadata: Record<string, unknown> | null }).store_metadata ?? {};
  const storeId = String(meta["store_id"] ?? meta["id"] ?? "");
  if (!storeId) return null;

  // Decrypt the access token via Postgres helper fn_decrypt_oauth.
  // We use RPC to avoid shipping plaintext bytes through the app layer.
  const { data: decrypted, error: decErr } = await admin.rpc(
    "fn_decrypt_oauth" as never,
    {
      p_organization_id: organizationId,
      p_integration_id: (data as { id: string }).id,
    } as never,
  );

  if (decErr || !decrypted) return null;

  const accessToken = String(decrypted);
  if (!accessToken) return null;

  return { accessToken, storeId };
}

/**
 * Fetches a single product from Nuvemshop REST API.
 * Returns null when credentials are unavailable or product not found.
 */
async function fetchNuvemshopProduct(
  organizationId: string,
  productId: string,
): Promise<NuvemshopProduct | null> {
  const creds = await resolveNuvemshopCredentials(organizationId);
  if (!creds) {
    // Wave 4 stub — full Nuvemshop credential resolution implemented in S-06.x
    // Concern: fn_decrypt_oauth RPC may not exist; if so, this returns null gracefully.
    console.warn(
      "[rag-indexer] nuvemshop credentials unavailable for org",
      organizationId,
      "— skipping product fetch (stub path)",
    );
    return null;
  }

  const client = new NuvemshopApiClient({
    storeId: creds.storeId,
    accessToken: creds.accessToken,
  });

  try {
    const product = await client.get<NuvemshopProduct>(`/products/${productId}`);
    return product ?? null;
  } catch (err) {
    console.warn(
      "[rag-indexer] fetchNuvemshopProduct failed",
      productId,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleProductSynced(row: EventRow, agentId: string): Promise<ProcessResult> {
  const productId = String(row.payload["product_id"] ?? "");
  if (!productId) {
    return skip("missing_product_id_in_payload");
  }

  const product = await fetchNuvemshopProduct(row.organization_id, productId);
  if (!product) {
    return skip("product_fetch_failed_or_stub");
  }

  const text = formatProductForRag(product);
  const chunks = chunkText(text);

  if (chunks.length === 0) {
    return skip("no_chunks_generated");
  }

  // Create a new version in 'building' status.
  const { versionId, versionNumber } = await createKnowledgeVersion({
    agentId,
    organizationId: row.organization_id,
    sourceType: "nuvemshop_product",
  });

  console.warn(
    `[rag-indexer] created version ${versionNumber} (${versionId}) for org ${row.organization_id}`,
  );

  // Embed and upsert each chunk.
  const admin = createAdminClient();
  let successCount = 0;

  for (let i = 0; i < chunks.length; i++) {
    const content = chunks[i] ?? "";
    if (!content) continue;
    const contentHash = computeContentHash(content);

    let embedding: number[];
    try {
      const result = await embedText(content, { organizationId: row.organization_id });
      embedding = result.embedding;
    } catch (err) {
      // If embedding fails mid-way, abort and fail the version.
      const detail = err instanceof Error ? err.message : String(err);
      return { type: "error", detail: `embed_failed at chunk ${i}: ${detail}` };
    }

    // Upsert chunk — conflict on (organization_id, kb_version_id, content_hash) → do nothing
    const { error: upsertErr } = await admin.from("ai_chunks").upsert(
      {
        organization_id: row.organization_id,
        kb_version_id: versionId,
        knowledge_source_id: null, // product-level indexing; source link deferred to S-06.05
        position: i,
        content,
        content_hash: contentHash,
        token_count: estimateTokens(content),
        embedding: embedding as unknown as string,
        metadata: {
          source_type: "nuvemshop_product",
          product_id: productId,
        },
      },
      {
        onConflict: "knowledge_source_id,kb_version_id,position",
        ignoreDuplicates: true,
      },
    );

    if (upsertErr) {
      // Log but don't fail the whole version for a single chunk upsert error.
      console.warn(`[rag-indexer] chunk upsert error at position ${i}:`, upsertErr.message);
    } else {
      successCount++;
    }
  }

  if (successCount === 0) {
    await markVersionFailed(versionId, row.organization_id, "nenhum chunk gravado");
    return { type: "error", detail: "no_chunks_written" };
  }

  await markVersionReady(versionId, row.organization_id, successCount);
  await activateVersion({
    agentId,
    versionId,
    organizationId: row.organization_id,
  });

  return { type: "ok", versionId, chunkCount: successCount };
}

/**
 * Reconstrói uma única versão com todas as fontes prontas do agente. A versão
 * nova só é ativada depois de possuir chunks reais; se algo falhar, a versão
 * anterior permanece atendendo.
 */
async function handleKnowledgeSourceUpdated(
  row: EventRow,
  agentId: string,
): Promise<ProcessResult> {
  const admin = createAdminClient();
  const { data: sourceRows, error: sourceError } = await admin
    .from("ai_knowledge_sources")
    .select("id, source_type, name, source_metadata")
    .eq("organization_id", row.organization_id)
    .eq("agent_id", agentId)
    .eq("status", "ready")
    .eq("is_active", true);
  if (sourceError) return { type: "error", detail: `sources_query_failed: ${sourceError.message}` };

  const sources = (sourceRows ?? []) as Array<{
    id: string;
    source_type: string;
    name: string;
    source_metadata: Record<string, unknown> | null;
  }>;
  if (sources.length === 0) return skip("no_sources");

  const { data: itemRows, error: itemError } = await admin
    .from("ai_faq_items")
    .select("knowledge_source_id, question, answer, position")
    .eq("organization_id", row.organization_id)
    .in(
      "knowledge_source_id",
      sources.map((source) => source.id),
    )
    .order("position", { ascending: true });
  if (itemError) return { type: "error", detail: `items_query_failed: ${itemError.message}` };

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const chunks: Array<{ content: string; sourceId: string; sourceType: string }> = [];
  for (const item of (itemRows ?? []) as Array<{
    knowledge_source_id: string;
    question: string;
    answer: string;
  }>) {
    const source = sourceById.get(item.knowledge_source_id);
    if (!source) continue;
    for (const content of chunkText(`Pergunta: ${item.question}\nResposta: ${item.answer}`)) {
      chunks.push({ content, sourceId: source.id, sourceType: source.source_type });
    }
  }

  for (const source of sources.filter((candidate) => candidate.source_type === "policy")) {
    const blobPath = source.source_metadata?.["blob_path"];
    const filename = String(source.source_metadata?.["filename"] ?? "").toLowerCase();
    if (typeof blobPath !== "string" || (!filename.endsWith(".pdf") && !filename.endsWith(".md"))) {
      continue;
    }
    try {
      const extracted = await ingestPolicyFile({
        organizationId: row.organization_id,
        agentId,
        knowledgeSourceId: source.id,
        blobPath,
        ext: filename.endsWith(".pdf") ? "pdf" : "md",
      });
      for (const content of extracted.chunks) {
        chunks.push({ content, sourceId: source.id, sourceType: source.source_type });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await admin
        .from("ai_knowledge_sources")
        .update({ last_index_status: "failed", last_index_error: detail })
        .eq("id", source.id)
        .eq("organization_id", row.organization_id);
      return { type: "error", detail: `policy_extract_failed: ${detail}` };
    }
  }

  const reusableSources = sources.filter(
    (source) => !["faq", "policy"].includes(source.source_type),
  );
  if (reusableSources.length > 0) {
    const { data: reusableRows, error: reusableError } = await admin
      .from("ai_chunks")
      .select("knowledge_source_id, content")
      .eq("organization_id", row.organization_id)
      .in(
        "knowledge_source_id",
        reusableSources.map((source) => source.id),
      );
    if (reusableError) {
      return { type: "error", detail: `existing_chunks_query_failed: ${reusableError.message}` };
    }
    for (const item of (reusableRows ?? []) as Array<{
      knowledge_source_id: string | null;
      content: string;
    }>) {
      if (!item.knowledge_source_id) continue;
      const source = sourceById.get(item.knowledge_source_id);
      if (!source) continue;
      chunks.push({ content: item.content, sourceId: source.id, sourceType: source.source_type });
    }
  }
  const uniqueChunks = Array.from(
    new Map(
      chunks.map((chunk) => [`${chunk.sourceId}:${computeContentHash(chunk.content)}`, chunk]),
    ).values(),
  );
  const requestedSourceId =
    typeof row.payload["knowledge_source_id"] === "string"
      ? row.payload["knowledge_source_id"]
      : null;
  if (uniqueChunks.length === 0) {
    if (requestedSourceId) {
      await admin
        .from("ai_knowledge_sources")
        .update({
          last_index_status: "partial",
          last_index_error: "Nenhum conteúdo disponível para indexar nesta fonte.",
          chunks_count: 0,
        })
        .eq("id", requestedSourceId)
        .eq("organization_id", row.organization_id);
    }
    return skip("no_content_to_index");
  }

  const { versionId } = await createKnowledgeVersion({
    agentId,
    organizationId: row.organization_id,
    sourceType: "knowledge_source",
  });
  let written = 0;
  const writtenBySource = new Map<string, number>();

  for (let index = 0; index < uniqueChunks.length; index++) {
    const chunk = uniqueChunks[index]!;
    try {
      const { embedding } = await embedText(chunk.content, { organizationId: row.organization_id });
      const { error } = await admin.from("ai_chunks").upsert(
        {
          organization_id: row.organization_id,
          kb_version_id: versionId,
          knowledge_source_id: chunk.sourceId,
          position: index,
          content: chunk.content,
          content_hash: computeContentHash(chunk.content),
          token_count: estimateTokens(chunk.content),
          embedding: embedding as unknown as string,
          metadata: { source_type: chunk.sourceType },
        },
        { onConflict: "knowledge_source_id,kb_version_id,position", ignoreDuplicates: true },
      );
      if (error) throw new Error(error.message);
      written++;
      writtenBySource.set(chunk.sourceId, (writtenBySource.get(chunk.sourceId) ?? 0) + 1);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await markVersionFailed(versionId, row.organization_id, `index_failed@${index}: ${detail}`);
      return { type: "error", detail: `index_failed at chunk ${index}: ${detail}` };
    }
  }

  if (written === 0) {
    await markVersionFailed(versionId, row.organization_id, "nenhum chunk gravado");
    return { type: "error", detail: "no_chunks_written" };
  }

  await markVersionReady(versionId, row.organization_id, written);
  await activateVersion({ agentId, versionId, organizationId: row.organization_id });

  const indexedAt = new Date().toISOString();
  for (const source of sources) {
    const sourceCount = writtenBySource.get(source.id) ?? 0;
    if (sourceCount === 0 && source.id !== requestedSourceId) continue;
    await admin
      .from("ai_knowledge_sources")
      .update({
        last_index_status: sourceCount > 0 ? "success" : "partial",
        last_index_error:
          sourceCount > 0 ? null : "Nenhum conteúdo disponível para indexar nesta fonte.",
        last_indexed_at: indexedAt,
        chunks_count: sourceCount,
      })
      .eq("id", source.id)
      .eq("organization_id", row.organization_id);
  }

  return { type: "ok", versionId, chunkCount: written };
}

// ---------------------------------------------------------------------------
// Main processor — exported for handler adapter + unit tests
// ---------------------------------------------------------------------------

export async function processRagIndexer(row: EventRow): Promise<HandlerResult> {
  const consumerKey = "rag-indexer.v1";

  // Lag monitor (IA-11)
  const lagMs = Date.now() - new Date((row.payload["created_at"] as string) ?? row.id).getTime();
  if (lagMs > LAG_WARN_MS) {
    console.warn(
      `[rag-indexer] lag exceeded 5min: ${Math.round(lagMs / 1000)}s for event ${row.id} (${row.event_type})`,
    );
  }

  // Resolve the active agent for this org.
  let agentId: string;
  try {
    const eventAgentId =
      typeof row.payload["agent_id"] === "string" ? row.payload["agent_id"] : undefined;
    const agent = await resolveAgent(row.organization_id, eventAgentId);
    if (!agent) {
      return { consumer_key: consumerKey, status: "skipped", detail: "agent_inactive_or_missing" };
    }
    agentId = agent.id;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[rag-indexer] resolveAgent failed:", detail);
    return { consumer_key: consumerKey, status: "error", detail };
  }

  // Debounce key scoped to (org, agent, event_type) to coalesce bursts.
  const debounceKey = `rag:debounce:${row.organization_id}:${agentId}:${row.event_type}`;
  const acquired = await acquireDebounce(debounceKey, DEBOUNCE_TTL_SEC);
  if (!acquired) {
    return { consumer_key: consumerKey, status: "skipped", detail: "debounced" };
  }

  let versionId: string | undefined;

  try {
    let result: ProcessResult;

    switch (row.event_type) {
      case "nuvemshop.product_synced":
        result = await handleProductSynced(row, agentId);
        break;

      case "knowledge_source.updated":
        result = await handleKnowledgeSourceUpdated(row, agentId);
        break;

      default:
        return {
          consumer_key: consumerKey,
          status: "skipped",
          detail: `unhandled_event:${row.event_type}`,
        };
    }

    if (result.type === "skip") {
      return { consumer_key: consumerKey, status: "skipped", detail: result.reason };
    }

    if (result.type === "error") {
      if (versionId) {
        await markVersionFailed(versionId, row.organization_id, result.detail).catch(() => {
          // best-effort
        });
      }
      return { consumer_key: consumerKey, status: "error", detail: result.detail };
    }

    // type === "ok"
    versionId = result.versionId;
    return {
      consumer_key: consumerKey,
      status: "ok",
      detail: `version=${result.versionId} chunks=${result.chunkCount}`,
    };
  } catch (err) {
    // Global catch — worker must NOT throw.
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[rag-indexer] unhandled error:", detail);

    if (versionId) {
      await markVersionFailed(versionId, row.organization_id, detail).catch(() => {
        // best-effort
      });
    }

    return { consumer_key: consumerKey, status: "error", detail };
  }
}
