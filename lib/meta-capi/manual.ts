export type MetaConversionStatus = "pending" | "processing" | "sent" | "failed" | "skipped";

export function metaConversionEventId(leadId: string, eventName = "Purchase") {
  return `crm-meta:${leadId}:${eventName.toLowerCase()}`;
}

export function metaConversionHasDeliveryAuthorization(input: {
  event_origin?: string | null;
  rule_id?: string | null;
  requested_by_user_id?: string | null;
  requested_at?: string | null;
}) {
  if (!input.requested_at) return false;
  return Boolean(input.requested_by_user_id) || (input.event_origin === "automatic" && Boolean(input.rule_id));
}

export function metaConversionCanBeRequested(status: MetaConversionStatus | null) {
  return status === null || status === "failed" || status === "skipped";
}

export function metaConversionIsFinal(status: MetaConversionStatus | null) {
  return status === "sent";
}
