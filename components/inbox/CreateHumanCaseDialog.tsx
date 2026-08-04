"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";

interface Props {
  conversationId: string;
  contactName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

export function CreateHumanCaseDialog({
  conversationId,
  contactName,
  open,
  onOpenChange,
  onCreated,
}: Props) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [blocker, setBlocker] = useState("");
  const [urgency, setUrgency] = useState("normal");
  const [assigneeUserId, setAssigneeUserId] = useState("queue");
  const [includeConversationLink, setIncludeConversationLink] = useState(true);
  const [notifyManagerGroup, setNotifyManagerGroup] = useState(false);
  const [saving, setSaving] = useState(false);
  const members = useAssignableMembers(open);

  useEffect(() => {
    if (!open || summary.trim()) return;
    let cancelled = false;
    void apiClient
      .get<{ data: { summary: string | null; next_action: string | null } }>(
        `/api/v1/conversations/${conversationId}/ai-context`,
      )
      .then((response) => {
        if (cancelled) return;
        const suggestion = [
          response.data.summary,
          response.data.next_action && `Próxima ação: ${response.data.next_action}`,
        ]
          .filter(Boolean)
          .join("\n\n");
        if (suggestion) setSummary(suggestion);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, conversationId, summary]);

  async function submit() {
    if (title.trim().length < 3 || summary.trim().length < 3 || blocker.trim().length < 3) {
      toast.error("Preencha título, resumo e motivo do encaminhamento.");
      return;
    }
    setSaving(true);
    try {
      await apiClient.post("/api/v1/ai/cases", {
        conversation_id: conversationId,
        title: title.trim(),
        summary: summary.trim(),
        blocker: blocker.trim(),
        urgency,
        assignee_user_id: assigneeUserId === "queue" ? null : assigneeUserId,
        include_conversation_link: includeConversationLink,
        notify_manager_group: notifyManagerGroup,
      });
      toast.success("Caso humano criado.");
      setTitle("");
      setSummary("");
      setBlocker("");
      setUrgency("normal");
      setAssigneeUserId("queue");
      setIncludeConversationLink(true);
      setNotifyManagerGroup(false);
      onOpenChange(false);
      onCreated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar o caso.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Criar caso humano</DialogTitle>
          <DialogDescription>
            Encaminhe a conversa de {contactName} com contexto suficiente para a equipe continuar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="human-case-title">Título</Label>
            <Input
              id="human-case-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ex.: Conferir documentação recebida"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="human-case-summary">Resumo para o atendente</Label>
            <Textarea
              id="human-case-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              rows={4}
              placeholder="Pedido do cliente, dados já coletados e o que falta fazer."
            />
            <p className="text-xs text-muted-foreground">
              O CRM sugere o resumo usando o contexto acumulado; você pode editar antes de criar.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="human-case-blocker">Motivo do encaminhamento</Label>
            <Textarea
              id="human-case-blocker"
              value={blocker}
              onChange={(event) => setBlocker(event.target.value)}
              rows={2}
              placeholder="Por que este caso precisa de uma pessoa?"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="human-case-assignee">Responsável ou fila</Label>
            <Select value={assigneeUserId} onValueChange={setAssigneeUserId}>
              <SelectTrigger id="human-case-assignee">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="queue">Fila de casos humanos</SelectItem>
                {(members.data ?? []).map((member) => (
                  <SelectItem key={member.user_id} value={member.user_id}>
                    {member.full_name || `Membro da equipe (${member.role})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <span>
              <span className="block font-medium">Incluir link da conversa completa</span>
              <span className="text-xs text-muted-foreground">
                O resumo continua curto; o histórico fica acessível pelo link.
              </span>
            </span>
            <Switch
              checked={includeConversationLink}
              onCheckedChange={setIncludeConversationLink}
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <span>
              <span className="block font-medium">Publicar no grupo de gestores</span>
              <span className="text-xs text-muted-foreground">
                Só será enviado se o grupo estiver configurado e autorizado.
              </span>
            </span>
            <Switch checked={notifyManagerGroup} onCheckedChange={setNotifyManagerGroup} />
          </label>
          <div className="space-y-2">
            <Label htmlFor="human-case-urgency">Urgência</Label>
            <Select value={urgency} onValueChange={setUrgency}>
              <SelectTrigger id="human-case-urgency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Baixa</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="high">Alta</SelectItem>
                <SelectItem value="critical">Crítica</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={saving} onClick={() => void submit()}>
            {saving ? "Criando…" : "Criar caso humano"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
