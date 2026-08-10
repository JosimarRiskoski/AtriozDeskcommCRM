"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useChannelSessions } from "@/hooks/channels/useChannelSessions";
import { apiClient } from "@/lib/api/client";

interface Props {
  contactId: string;
  contactName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Abre uma conversa somente quando a primeira mensagem for realmente enviada. */
export function StartContactConversationDialog({ contactId, contactName, open, onOpenChange }: Props) {
  const router = useRouter();
  const channels = useChannelSessions({ enabled: open });
  const workingChannels = useMemo(
    () => (channels.data ?? []).filter((channel) => channel.status === "WORKING"),
    [channels.data],
  );
  const [channelId, setChannelId] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChannelId((current) => current || workingChannels[0]?.id || "");
    setMessage("");
  }, [open, workingChannels]);

  async function start() {
    setSending(true);
    try {
      const response = await apiClient.post<{ data: { conversation_id: string } }>(
        "/api/v1/conversations/start",
        { contact_id: contactId, channel_session_id: channelId, body: message },
      );
      toast.success("Mensagem enviada e conversa iniciada.");
      onOpenChange(false);
      router.push(`/app/inbox/${response.data.conversation_id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível iniciar a conversa.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Iniciar conversa no WhatsApp</DialogTitle>
          <DialogDescription>
            A conversa com {contactName} só será criada depois que a primeira mensagem for enviada.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="contact-conversation-channel">Número que enviará a mensagem</Label>
            <select
              id="contact-conversation-channel"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={channelId}
              onChange={(event) => setChannelId(event.target.value)}
              disabled={channels.isLoading || sending}
            >
              <option value="">Selecione uma conexão ativa</option>
              {workingChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.display_name || channel.external_session_name}
                  {channel.phone_number ? ` · ${channel.phone_number}` : ""}
                </option>
              ))}
            </select>
            {!channels.isLoading && workingChannels.length === 0 ? (
              <p className="text-xs text-destructive">Não há nenhum número WhatsApp ativo para enviar.</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-conversation-message">Primeira mensagem</Label>
            <Textarea
              id="contact-conversation-message"
              rows={5}
              placeholder="Escreva uma mensagem"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              disabled={sending}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancelar
          </Button>
          <Button disabled={!channelId || !message.trim() || sending} onClick={() => void start()}>
            {sending ? "Enviando…" : "Enviar e abrir conversa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
