import { Badge } from "@/components/ui/badge";
import { channelColor, channelColorStyles, channelDisplayLabel } from "@/lib/channels/display";
import { cn } from "@/lib/utils";

export function ChannelBadge({
  channel,
  compact = false,
  className,
}: {
  channel: {
    display_name?: string | null;
    phone_number?: string | null;
    external_session_name?: string | null;
    display_color?: string | null;
    archived_at?: string | null;
  };
  compact?: boolean;
  className?: string;
}) {
  const color = channelColor(channel.display_color);
  const label = channelDisplayLabel(channel);
  const finalDigits = channel.phone_number?.replace(/\D/g, "").slice(-4);
  const text = compact
    ? label
    : `${label}${finalDigits && channel.display_name ? ` · ${finalDigits}` : ""}`;

  return (
    <Badge
      variant="outline"
      className={cn("max-w-full gap-1.5 font-normal", className)}
      style={channelColorStyles(color)}
      title={`${label}${channel.archived_at ? " (arquivada)" : ""}`}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="truncate">{text}</span>
      {channel.archived_at ? <span className="opacity-70">Arquivada</span> : null}
    </Badge>
  );
}
