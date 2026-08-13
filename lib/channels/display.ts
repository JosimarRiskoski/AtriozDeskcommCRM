export const DEFAULT_CHANNEL_COLOR = "#3B82F6";

export const CHANNEL_COLOR_PALETTE = [
  "#3B82F6",
  "#A855F7",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#06B6D4",
  "#EC4899",
  "#64748B",
] as const;

export function channelDisplayLabel(channel: {
  display_name?: string | null;
  phone_number?: string | null;
  external_session_name?: string | null;
}): string {
  return (
    channel.display_name || channel.phone_number || channel.external_session_name || "WhatsApp"
  );
}

export function channelColor(color: string | null | undefined): string {
  return /^#[0-9a-f]{6}$/i.test(color ?? "")
    ? (color as string).toUpperCase()
    : DEFAULT_CHANNEL_COLOR;
}

export function channelColorStyles(color: string | null | undefined): {
  borderColor: string;
  color: string;
  backgroundColor: string;
} {
  const safe = channelColor(color);
  return {
    borderColor: `${safe}80`,
    color: safe,
    backgroundColor: `${safe}18`,
  };
}
