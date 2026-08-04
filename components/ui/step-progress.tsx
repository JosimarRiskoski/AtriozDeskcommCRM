import { cn } from "@/lib/utils";

export function StepProgress({ labels, current }: { labels: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label={`Etapa ${current + 1} de ${labels.length}`}>
      {labels.map((label, index) => (
        <li key={label} className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
              index <= current ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
            )}
          >
            {index + 1}
          </span>
          <span className={cn("hidden text-xs sm:inline", index === current ? "font-medium" : "text-muted-foreground")}>
            {label}
          </span>
          {index < labels.length - 1 ? <span className="h-px w-5 bg-border" aria-hidden /> : null}
        </li>
      ))}
    </ol>
  );
}
