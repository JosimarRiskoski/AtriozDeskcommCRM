import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Message } from "@/lib/types/messaging";
import type { SendMessageInput } from "@/lib/schemas";

const ENDPOINT = "POST:/api/v1/messages";

export type MessageSendClaim =
  | { state: "claimed"; requestHash: string }
  | { state: "cached"; message: Message }
  | { state: "processing" }
  | { state: "conflict" };

export function hashMessageSend(input: SendMessageInput): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

function normalizedHash(value: string): string {
  return value.startsWith("\\x") ? value.slice(2) : value;
}

export async function claimMessageSend(
  supabase: SupabaseClient,
  organizationId: string,
  key: string,
  input: SendMessageInput,
): Promise<MessageSendClaim> {
  const requestHash = hashMessageSend(input);
  const processingExpiry = new Date(Date.now() + 5 * 60_000).toISOString();
  const { error: claimError } = await supabase.from("idempotency_keys").insert({
    organization_id: organizationId,
    key,
    endpoint: ENDPOINT,
    request_hash: `\\x${requestHash}`,
    status_code: 102,
    response_body: { state: "processing" },
    expires_at: processingExpiry,
  });

  if (!claimError) return { state: "claimed", requestHash };
  if (claimError.code !== "23505") throw new Error(`idempotency_claim_failed:${claimError.message}`);

  const { data, error } = await supabase
    .from("idempotency_keys")
    .select("request_hash, status_code, response_body")
    .eq("organization_id", organizationId)
    .eq("endpoint", ENDPOINT)
    .eq("key", key)
    .maybeSingle();
  if (error || !data) throw new Error(`idempotency_lookup_failed:${error?.message ?? "not_found"}`);
  if (normalizedHash(String(data.request_hash)) !== requestHash) return { state: "conflict" };
  if (data.status_code === 102) return { state: "processing" };
  return { state: "cached", message: data.response_body as Message };
}

export async function completeMessageSend(
  supabase: SupabaseClient,
  organizationId: string,
  key: string,
  requestHash: string,
  message: Message,
): Promise<void> {
  const { error } = await supabase
    .from("idempotency_keys")
    .update({
      request_hash: `\\x${requestHash}`,
      status_code: 201,
      response_body: message,
      expires_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("endpoint", ENDPOINT)
    .eq("key", key);
  if (error) console.error("[messages.send] idempotency complete failed", error.message);
}

export async function releaseMessageSend(
  supabase: SupabaseClient,
  organizationId: string,
  key: string,
): Promise<void> {
  const { error } = await supabase
    .from("idempotency_keys")
    .delete()
    .eq("organization_id", organizationId)
    .eq("endpoint", ENDPOINT)
    .eq("key", key)
    .eq("status_code", 102);
  if (error) console.error("[messages.send] idempotency release failed", error.message);
}
