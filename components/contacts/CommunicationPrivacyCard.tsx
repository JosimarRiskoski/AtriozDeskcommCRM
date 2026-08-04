"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface CommunicationEvent {
  id: string;
  action: "blocked" | "reactivated";
  reason: string;
  source: string;
  actor_user_id: string | null;
  created_at: string;
}

export function CommunicationPrivacyCard({
  contactId,
  isBlocked,
  blockedReason,
  blockedAt,
  canManage,
}: {
  contactId: string;
  isBlocked: boolean;
  blockedReason: string | null;
  blockedAt?: string | null;
  canManage: boolean;
}) {
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();
  const history = useQuery({
    queryKey: ["contact-communication", contactId],
    queryFn: async () =>
      (
        await apiClient.get<{ data: CommunicationEvent[] }>(
          `/api/v1/contacts/${contactId}/communication`,
        )
      ).data,
  });
  const change = useMutation({
    mutationFn: (action: "block" | "reactivate") =>
      apiClient.post(`/api/v1/contacts/${contactId}/communication`, { action, reason }),
    onSuccess: async () => {
      toast.success(isBlocked ? "Contato reativado." : "Contato excluído e bloqueado.");
      setReason("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["contact", contactId] }),
        queryClient.invalidateQueries({ queryKey: ["contact-communication", contactId] }),
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao atualizar."),
  });

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Comunicação e privacidade</h2>
          <p className="text-sm text-muted-foreground">
            O bloqueio vale para mensagens manuais, IA, campanhas, follow-ups e integrações.
          </p>
        </div>
        <Badge variant={isBlocked ? "destructive" : "success"}>
          {isBlocked ? "Excluído — bloqueio total" : "Ativo"}
        </Badge>
      </div>
      {isBlocked ? (
        <div className="border-destructive/30 bg-destructive/5 rounded-md border p-3 text-sm">
          <p>
            <strong>Motivo:</strong> {blockedReason || "Não informado"}
          </p>
          {blockedAt ? (
            <p className="mt-1 text-xs">Desde {new Date(blockedAt).toLocaleString("pt-BR")}</p>
          ) : null}
        </div>
      ) : null}
      {canManage ? (
        <div className="space-y-2">
          <Label htmlFor="communication-reason">
            {isBlocked ? "Justificativa para reativar" : "Motivo do bloqueio"}
          </Label>
          <Textarea
            id="communication-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={
              isBlocked
                ? "Ex.: cliente autorizou novamente em 03/08"
                : "Ex.: solicitação de opt-out confirmada"
            }
          />
          <Button
            variant={isBlocked ? "outline" : "destructive"}
            disabled={reason.trim().length < 3 || change.isPending}
            onClick={() => {
              const label = isBlocked ? "reativar este contato" : "aplicar bloqueio total";
              if (window.confirm(`Deseja ${label}?`))
                change.mutate(isBlocked ? "reactivate" : "block");
            }}
          >
            {isBlocked ? "Reativar contato" : "Excluir/bloquear contato"}
          </Button>
        </div>
      ) : null}
      <div>
        <h3 className="text-sm font-medium">Histórico</h3>
        {history.data?.length ? (
          <ol className="mt-2 space-y-2 text-sm">
            {history.data.map((event) => (
              <li key={event.id} className="rounded-md border p-2">
                <span className="font-medium">
                  {event.action === "blocked" ? "Bloqueado" : "Reativado"}
                </span>
                {` · ${event.reason}`}
                <p className="text-xs text-muted-foreground">
                  {new Date(event.created_at).toLocaleString("pt-BR")} · {event.source}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Nenhuma alteração registrada.</p>
        )}
      </div>
    </Card>
  );
}
