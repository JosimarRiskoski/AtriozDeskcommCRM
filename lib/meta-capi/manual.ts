export type MetaConversionStatus = "pending" | "processing" | "sent" | "failed" | "skipped";

export function metaConversionEventId(leadId: string) {
  return `crm-conversion-${leadId}`;
}

export function metaConversionCanBeRequested(status: MetaConversionStatus | null) {
  return status === null || status === "failed" || status === "skipped";
}

export function metaConversionIsFinal(status: MetaConversionStatus | null) {
  return status === "sent";
}
