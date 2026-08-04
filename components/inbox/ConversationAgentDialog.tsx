"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAssignableAgents } from "@/hooks/kanban/useAssignableAgents";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

export function ConversationAgentDialog({
  conversationId,
  currentAgentId,
  currentReason,
  humanAttending,
  open,
  onOpenChange,
}: {
  conversationId: string;
  currentAgentId: string | null;
  currentReason: string | null;
  humanAttending: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const agents = useAssignableAgents(open);
  const queryClient = useQueryClient();
  const [agentId, setAgentId] = useState(currentAgentId ?? "inherit");
  const [reason, setReason] = useState(currentReason ?? "");
  useEffect(() => {
    if (open) {
      setAgentId(currentAgentId ?? "inherit");
      setReason(currentReason ?? "");
    }
  }, [open, currentAgentId, currentReason]);
  const save = useMutation({
    mutationFn: async () =>
      (
        await apiClient.patch<{ data: { message: string } }>(
          `/api/v1/conversations/${conversationId}/agent-selection`,
          { agent_id: agentId === "inherit" ? null : agentId, reason: reason.trim() },
        )
      ).data,
    onSuccess: (data) => {
      toast.success(data.message);
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      void queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
      onOpenChange(false);
    },
    onError: showApiError,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agente desta conversa</DialogTitle>
          <DialogDescription>
            A escolha manual prevalece sobre conexão, origem e etapa. Volte para “Regra automática”
            quando quiser remover a exceção.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {humanAttending ? (
            <div className="rounded-md border border-warning bg-warning-bg p-3 text-sm text-warning-fg">
              Há uma pessoa atendendo. A escolha será salva, mas a IA não assumirá nem será trocada
              automaticamente até o atendimento humano terminar.
            </div>
          ) : null}
          <div className="space-y-2">
            <Label>Agente</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">Regra automática</SelectItem>
                {(agents.data ?? [])
                  .filter((agent) => agent.version_number !== null)
                  .map((agent) => (
                    <SelectItem key={agent.agent_id} value={agent.agent_id}>
                      {agent.name} · v{agent.version_number}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-selection-reason">Motivo da escolha</Label>
            <Textarea
              id="agent-selection-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ex.: conversa de tráfego pago; usar agente comercial."
              rows={3}
            />
            <p className="text-xs text-muted-foreground">O motivo fica no histórico da conversa.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={save.isPending || reason.trim().length < 3}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Salvando…" : "Salvar agente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
