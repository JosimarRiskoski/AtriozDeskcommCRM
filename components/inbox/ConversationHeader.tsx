"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Phone, ArrowRight, Pause, Play } from "@/lib/ui/icons";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useClaimConversation } from "@/hooks/inbox/useClaimConversation";
import { useReleaseConversation } from "@/hooks/inbox/useReleaseConversation";
import { useCloseConversation } from "@/hooks/inbox/useCloseConversation";
import { ReassignDialog } from "@/components/inbox/ReassignDialog";
import { SnoozeButton } from "@/components/inbox/SnoozeButton";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";
import { useConversationAiControl } from "@/hooks/inbox/useConversationAiControl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Props {
  conversation: ConversationWithContact;
}

const STATUS_LABEL: Record<string, string> = {
  open: "Aberta",
  claimed: "Em atendimento",
  ai_handling: "IA atendendo",
  closed: "Fechada",
  archived: "Arquivada",
};

export function ConversationHeader({ conversation }: Props) {
  const [renderedAt] = useState(() => Date.now());
  const { user } = useAuth();
  const claim = useClaimConversation();
  const release = useReleaseConversation();
  const close = useCloseConversation();
  const aiControl = useConversationAiControl(conversation.id);
  const [reassignOpen, setReassignOpen] = useState(false);

  const c = conversation.contacts ?? null;
  const displayName = c?.display_name?.trim() || c?.name?.trim() || c?.phone_number || "Sem nome";
  const phone = c?.phone_number ?? null;
  const status = conversation.status;
  const isMineAssigned = conversation.assigned_to_user_id === user.id;
  const isOpen = status === "open" || conversation.assigned_to_user_id == null;
  const aiPaused = Boolean(
    conversation.ai_control_mode === "force_paused" ||
      (conversation.bot_silenced_until &&
        (conversation.bot_silenced_until === "infinity" ||
          new Date(conversation.bot_silenced_until).getTime() > renderedAt)),
  );
  const aiForcedActive = conversation.ai_control_mode === "force_active";

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-sm font-semibold">{displayName}</h2>
          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
            {STATUS_LABEL[status] ?? status}
          </Badge>
        </div>
        {phone && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Phone size={11} weight="regular" aria-hidden /> {phone}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant={aiForcedActive ? "default" : "outline"}
              disabled={aiControl.setMode.isPending}
              title="Definir como a IA deve agir somente nesta conversa"
            >
              {aiPaused ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
              {aiForcedActive ? "IA ativa aqui" : aiPaused ? "IA pausada" : "Controle da IA"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel>
              <span className="block">IA neste contato</span>
              <span className="text-xs font-normal text-muted-foreground">
                Esta escolha vale somente para esta conversa.
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => aiControl.setMode.mutate("inherit")}>
              <span>
                <span className="block">Seguir configuração geral</span>
                <span className="text-xs text-muted-foreground">Usa o estado normal do agente.</span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => aiControl.setMode.mutate("force_active")}>
              <Play size={14} aria-hidden />
              <span>
                <span className="block">Ativar IA somente neste contato</span>
                <span className="text-xs text-muted-foreground">Útil para testes controlados.</span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => aiControl.setMode.mutate("force_paused")}>
              <Pause size={14} aria-hidden />
              <span>
                <span className="block">Pausar IA neste contato</span>
                <span className="text-xs text-muted-foreground">O atendimento fica com a equipe.</span>
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {isOpen && (
          <Button
            size="sm"
            variant="default"
            disabled={claim.isPending}
            onClick={() =>
              claim.mutate({
                conversation_id: conversation.id,
                expected_assignee: conversation.assigned_to_user_id,
              })
            }
          >
            Assumir
          </Button>
        )}
        {isMineAssigned && (
          <Button
            size="sm"
            variant="outline"
            disabled={release.isPending}
            onClick={() => release.mutate({ conversation_id: conversation.id })}
          >
            Liberar
          </Button>
        )}
        {status !== "closed" && status !== "archived" && (
          <Button size="sm" variant="outline" onClick={() => setReassignOpen(true)}>
            Transferir
          </Button>
        )}
        {status !== "closed" && status !== "archived" && (
          <SnoozeButton
            conversationId={conversation.id}
            snoozeUntil={conversation.snooze_until ?? null}
          />
        )}
        {status !== "closed" && status !== "archived" && (
          <Button
            size="sm"
            variant="outline"
            disabled={close.isPending}
            onClick={() => {
              if (confirm("Fechar esta conversa?")) {
                close.mutate({ conversation_id: conversation.id });
              }
            }}
          >
            Fechar
          </Button>
        )}
        {c?.id && (
          <Button asChild size="sm" variant="ghost">
            <Link href={`/app/contacts/${c.id}`} className="flex items-center gap-1">
              Ver contato
              <ArrowRight size={12} weight="regular" aria-hidden />
            </Link>
          </Button>
        )}
      </div>
      <ReassignDialog
        conversationId={conversation.id}
        open={reassignOpen}
        onOpenChange={setReassignOpen}
      />
    </div>
  );
}
