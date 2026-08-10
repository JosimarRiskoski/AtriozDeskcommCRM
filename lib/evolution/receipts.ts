type Json = Record<string, unknown>;

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

export type ReceiptRpc = (name: string, args: Record<string, unknown>) => Promise<RpcResult>;

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

/** Converte os estados 1..5 e nomes da Evolution em ACK interno 0..4. */
export function ackFromEvolutionUpdate(data: Json): number {
  const update = object(data.update);
  const status = update.status ?? data.status;
  if (typeof status === "number") return Math.max(0, Math.min(4, status - 1));
  const normalized = String(status ?? "").toLowerCase();
  if (/play/.test(normalized)) return 4;
  if (/read/.test(normalized)) return 3;
  if (/deliver/.test(normalized)) return 2;
  if (/server|sent|ack/.test(normalized)) return 1;
  return 0;
}

export async function advanceEvolutionReceipt(
  rpc: ReceiptRpc,
  input: {
    organizationId: string;
    externalIds: string[];
    ack: number;
    provider: "evolution";
  },
): Promise<{ matched: number; updated: number }> {
  const { data, error } = await rpc("fn_advance_message_receipt", {
    p_organization_id: input.organizationId,
    p_external_ids: input.externalIds,
    p_ack: input.ack,
  });
  if (error) throw new Error(`message_receipt_update_failed:${error.message}`);
  const result = Array.isArray(data) ? object(data[0]) : object(data);
  const matched = Number(result.matched_count ?? 0);
  const updated = Number(result.updated_count ?? 0);
  if (matched === 0) {
    const alert = await rpc("emit_event", {
      p_event_type: "whatsapp.receipt_unmatched",
      p_entity_kind: "message",
      p_entity_id: null,
      p_payload: { external_ids: input.externalIds, ack: input.ack },
      p_metadata: { provider: input.provider, severity: "warn" },
      p_organization_id: input.organizationId,
    });
    if (alert.error) throw new Error(`receipt_unmatched_alert_failed:${alert.error.message}`);
  }
  return { matched, updated };
}
