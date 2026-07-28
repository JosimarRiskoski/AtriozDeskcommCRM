"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import type { OperationalHealthPayload } from "@/app/api/v1/system-health/route";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient } from "@/lib/api/client";

const META = {
  ok: { label: "Funcionando", variant: "success" as const },
  warning: { label: "Atenção", variant: "warning" as const },
  critical: { label: "Ação necessária", variant: "error" as const },
};

export function SystemHealthClient() {
  const query = useQuery({
    queryKey: ["system-health"],
    queryFn: () =>
      apiClient.get<{ data: OperationalHealthPayload }>("/api/v1/system-health").then((r) => r.data),
    refetchInterval: 60_000,
  });

  if (query.isLoading) {
    return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-44" />)}</div>;
  }
  if (query.isError || !query.data) {
    return <Card className="p-8 text-center text-sm text-error-fg">Não foi possível consultar a saúde agora.</Card>;
  }

  const overall = META[query.data.status];
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-semibold">Situação geral</p>
          <p className="text-xs text-muted-foreground">
            Verificado em {new Date(query.data.checked_at).toLocaleString("pt-BR")}
          </p>
        </div>
        <Badge variant={overall.variant}>{overall.label}</Badge>
      </Card>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {query.data.items.map((item) => {
          const meta = META[item.status];
          return (
            <Card key={item.id} className="flex min-h-44 flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-semibold">{item.label}</h2>
                <Badge variant={meta.variant}>{meta.label}</Badge>
              </div>
              <div>
                <p className="text-sm font-medium">{item.summary}</p>
                <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
              </div>
              {item.action_url && item.action_label ? (
                <Button asChild variant="outline" size="sm" className="mt-auto self-start">
                  <Link href={item.action_url}>{item.action_label}</Link>
                </Button>
              ) : null}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
