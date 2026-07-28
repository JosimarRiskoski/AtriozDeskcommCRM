"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStartFollowupEnrollment } from "@/hooks/followup/useFollowupEnrollments";
import { useFollowupFlows } from "@/hooks/followup/useFollowupFlows";
import { FlowArrow } from "@/lib/ui/icons";

export function StartFollowupCard({ contactId }: { contactId: string }) {
  const flowsQuery = useFollowupFlows();
  const start = useStartFollowupEnrollment();
  const [flowId, setFlowId] = useState("");
  const activeFlows = (flowsQuery.data ?? []).filter(
    (flow) => flow.status === "active" && flow.active_version_id,
  );

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start gap-3">
        <span className="rounded-md bg-muted p-2">
          <FlowArrow size={18} aria-hidden />
        </span>
        <div>
          <h2 className="font-semibold">Follow-up deste contato</h2>
          <p className="text-sm text-muted-foreground">
            Inicie manualmente uma sequência já publicada. Uma resposta do contato encerra as
            próximas tentativas.
          </p>
        </div>
      </div>

      {flowsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando fluxos…</p>
      ) : activeFlows.length === 0 ? (
        <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Nenhum fluxo publicado. Crie e publique um modelo em Follow-ups para poder iniciá-lo aqui.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="contact-followup-flow">Fluxo publicado</Label>
            <Select value={flowId} onValueChange={setFlowId}>
              <SelectTrigger id="contact-followup-flow">
                <SelectValue placeholder="Escolha um fluxo" />
              </SelectTrigger>
              <SelectContent>
                {activeFlows.map((flow) => (
                  <SelectItem key={flow.id} value={flow.id}>
                    {flow.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            disabled={!flowId || start.isPending}
            onClick={() => start.mutate({ pointerId: flowId, contactId })}
          >
            {start.isPending ? "Iniciando…" : "Iniciar follow-up"}
          </Button>
        </div>
      )}
    </Card>
  );
}
