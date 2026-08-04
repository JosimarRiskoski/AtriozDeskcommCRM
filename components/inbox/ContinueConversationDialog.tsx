"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api/client";

type Candidate = {
  id: string;
  display_name: string | null;
  phone_number: string | null;
  status: string;
};
type Preview = { recent_summary: string; suggested_message: string; candidates: Candidate[] };

export function ContinueConversationDialog({
  conversationId,
  open,
  onOpenChange,
}: {
  conversationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [connectionId, setConnectionId] = useState("");
  const [reason, setReason] = useState("Conexão anterior indisponível");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (!open) return;
    apiClient
      .get<{ data: Preview }>(`/api/v1/conversations/${conversationId}/continue-on-connection`)
      .then((res) => {
        setPreview(res.data);
        setMessage(res.data.suggested_message);
        setConnectionId(res.data.candidates[0]?.id ?? "");
      });
  }, [conversationId, open]);
  const submit = async () => {
    setSending(true);
    try {
      const response = await apiClient.post<{ data: { conversation_id: string } }>(
        `/api/v1/conversations/${conversationId}/continue-on-connection`,
        { connection_id: connectionId, reason, context_message: message, confirm: true },
      );
      toast.success("Conversa continuada pela nova conexão.");
      onOpenChange(false);
      router.push(`/app/inbox/${response.data.conversation_id}`);
    } finally {
      setSending(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Continuar por outra conexão</DialogTitle>
          <DialogDescription>
            A troca só acontece após sua confirmação e não ignora bloqueios do contato.
          </DialogDescription>
        </DialogHeader>
        {preview ? (
          <div className="space-y-4">
            <div className="bg-muted/30 rounded-md border p-3">
              <p className="text-xs font-medium">Resumo da conversa anterior</p>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-muted-foreground">
                {preview.recent_summary || "Sem mensagens recentes para resumir."}
              </pre>
            </div>
            <label className="space-y-2">
              <Label>Nova conexão saudável</Label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={connectionId}
                onChange={(e) => setConnectionId(e.target.value)}
              >
                <option value="">Escolha uma conexão</option>
                {preview.candidates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.display_name ?? item.phone_number ?? item.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <Label>Motivo registrado no histórico</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <label className="space-y-2">
              <Label>Mensagem que será enviada ao cliente</Label>
              <Textarea rows={6} value={message} onChange={(e) => setMessage(e.target.value)} />
            </label>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Preparando opções seguras…</p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={
              !preview ||
              !connectionId ||
              reason.trim().length < 3 ||
              message.trim().length < 3 ||
              sending
            }
            onClick={() => void submit()}
          >
            {sending ? "Enviando…" : "Confirmar e iniciar conversa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
