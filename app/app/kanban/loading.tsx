import { Skeleton } from "@/components/ui/skeleton";

export default function KanbanLoading() {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-6">
      <Skeleton className="mb-6 h-8 w-64" />
      <div className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden pb-2">
        <div className="flex h-full min-w-max gap-4">
          {Array.from({ length: 5 }).map((_, col) => (
            <div
              key={col}
              className="w-[min(18rem,calc(100vw-3rem))] flex-shrink-0 space-y-3 sm:w-72"
            >
              <Skeleton className="h-6 w-32" />
              {Array.from({ length: 3 }).map((_, card) => (
                <Skeleton key={card} className="h-24 w-full" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
