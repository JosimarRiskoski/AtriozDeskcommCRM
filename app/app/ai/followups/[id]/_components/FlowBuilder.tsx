"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { FollowupFlowDetailRow } from "@/hooks/followup/useFollowupFlow";
import { isSimpleFollowupGraph, SimpleFlowEditor } from "./SimpleFlowEditor";

/**
 * @xyflow/react is a large dependency — this is the ONLY route that loads it.
 * `ssr:false` + dynamic import keeps it out of the main bundle entirely; see
 * the bundle delta note in the task report.
 */
const FlowCanvas = dynamic(() => import("./FlowCanvas").then((m) => m.FlowCanvas), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[600px] items-center justify-center p-6">
      <Skeleton className="h-full w-full" />
    </div>
  ),
});

interface Props {
  flowId: string;
  initialData: FollowupFlowDetailRow;
}

export function FlowBuilder({ flowId, initialData }: Props) {
  const simpleCompatible = isSimpleFollowupGraph(initialData.draft_graph);
  const [advanced, setAdvanced] = useState(!simpleCompatible);

  return (
    <div className="flex h-full min-h-[600px] flex-1 flex-col" data-testid="flow-builder-shell">
      <div className="flex items-center justify-between border-b border-border bg-background px-4 py-2">
        <div>
          <p className="text-sm font-medium">
            {advanced ? "Editor avançado" : "Configuração simples"}
          </p>
          <p className="text-xs text-muted-foreground">
            {advanced
              ? "Use o grafo somente quando precisar de regras e ramificações especiais."
              : "Edite intervalos e mensagens sem lidar com nós técnicos."}
          </p>
        </div>
        {simpleCompatible && (
          <Button type="button" variant="outline" onClick={() => setAdvanced((value) => !value)}>
            {advanced ? "Voltar ao modo simples" : "Personalizar fluxo"}
          </Button>
        )}
      </div>
      {advanced ? (
        <FlowCanvas flowId={flowId} initialData={initialData} />
      ) : (
        <SimpleFlowEditor flowId={flowId} initialData={initialData} />
      )}
    </div>
  );
}
