"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiClient } from "@/lib/api/client";

type Item = {
  id: string;
  title: string;
  status: string;
  urgency: string;
  assignee_name: string | null;
};

export function OpenHumanCaseCard({ conversationId }: { conversationId: string }) {
  const { data } = useQuery({
    queryKey: ["conversation-human-case", conversationId],
    queryFn: () =>
      apiClient
        .get<{ data: { cases: Item[] } }>(
          `/api/v1/ai/cases?status=open&conversation_id=${conversationId}`,
        )
        .then((r) => r.data.cases[0] ?? null),
    refetchInterval: 60_000,
  });
  if (!data) return null;
  return (
    <Card className="border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            Caso humano aberto
          </p>
          <p className="mt-1 text-sm font-medium">{data.title}</p>
          <p className="text-xs text-muted-foreground">
            Responsável: {data.assignee_name ?? "a definir"}
          </p>
        </div>
        <Badge variant="warning">{data.urgency}</Badge>
      </div>
      <Button asChild size="sm" variant="outline" className="mt-3">
        <Link href="/app/ai/cases">Abrir fila de casos</Link>
      </Button>
    </Card>
  );
}
