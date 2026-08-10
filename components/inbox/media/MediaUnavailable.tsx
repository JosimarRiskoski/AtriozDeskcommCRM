import { cn } from "@/lib/utils";
import { ArrowsClockwise, ImageIcon } from "@/lib/ui/icons";

/** Fallback compartilhado quando a mídia não carrega (expirada/removida). */
export function MediaUnavailable({
  kind,
  className,
  onRetry,
}: {
  kind: string;
  className?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-lg bg-background/40 text-muted-foreground",
        className || "h-24 w-56",
      )}
    >
      <ImageIcon size={20} weight="duotone" aria-hidden />
      <span className="text-xs">Mídia indisponível</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-0.5 inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
        >
          <ArrowsClockwise size={13} aria-hidden />
          Tentar novamente
        </button>
      ) : null}
      <span className="sr-only">{kind}</span>
    </div>
  );
}
