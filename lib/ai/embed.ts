/**
 * Embedding wrapper for the RAG pipeline.
 *
 * Routes through Vercel AI Gateway when `AI_GATEWAY_API_KEY` is set; otherwise
 * uses the OpenAI provider directly (still no `@anthropic-ai/sdk`-style imports
 * — embeddings are an OpenAI capability and the gateway proxies them).
 */

import { createOpenAI } from "@ai-sdk/openai";
import { embed } from "ai";

import { loadLatestCredential } from "@/lib/ai/credentials";

import {
  DEFAULT_EMBEDDING_MODEL,
  gatewayConfig,
  gatewayHeaders,
  type ModelId,
} from "@/lib/ai/gateway";
import { env } from "@/lib/env";

export interface EmbedOptions {
  organizationId: string;
  model?: ModelId;
}

export interface EmbedResult {
  embedding: number[];
  promptTokens: number;
  model: string;
}

export async function embedText(content: string, opts: EmbedOptions): Promise<EmbedResult> {
  const model = opts.model ?? DEFAULT_EMBEDDING_MODEL;
  const cfg = gatewayConfig();
  let embeddingModel: Parameters<typeof embed>[0]["model"] = model;

  if (!cfg && !env.OPENAI_API_KEY) {
    try {
      const credential = await loadLatestCredential("openai", opts.organizationId);
      embeddingModel = createOpenAI({ apiKey: credential.apiKey }).embedding(
        String(model).replace(/^openai\//, ""),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "credencial OpenAI indisponível";
      throw new Error(`embed_unavailable: ${detail}`);
    }
  }

  // When using the gateway, model string `openai/text-embedding-3-small` is
  // routed automatically. The SDK reads AI_GATEWAY_API_KEY from process.env.
  // Headers are still attached for per-tenant observability + ZDR.
  const result = await embed({
    model: embeddingModel,
    value: content,
    headers: cfg ? gatewayHeaders({ organizationId: opts.organizationId }) : undefined,
  });

  // EmbedResult.embedding is `number[]` for single-value embed.
  const promptTokens =
    (result.usage as { tokens?: number; promptTokens?: number } | undefined)?.tokens ??
    (result.usage as { tokens?: number; promptTokens?: number } | undefined)?.promptTokens ??
    0;

  return {
    embedding: result.embedding,
    promptTokens,
    model: typeof model === "string" ? model : String(model),
  };
}
