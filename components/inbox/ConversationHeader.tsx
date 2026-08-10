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
import { useAiAutomation } from "@/hooks/ai/useAiAutomation";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useAssignableAgents } from "@/hooks/kanban/useAssignableAgents";
import { useChannelSessions } from "@/hooks/channels/useChannelSessions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConversationAgentDialog } from "@/components/inbox/ConversationAgentDialog";
import { ContinueConversationDialog } from "@/components/inbox/ContinueConversationDialog";

interface Props {
  conversation: ConversationWithContact;
  detailsOpen?: boolean;
  onToggleDetails?: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  open: "Aberta",
  claimed: "Em atendimento",
  ai_handling: "IA atendendo",
  closed: "Fechada",
  archived: "Arquivada",
};

export function ConversationHeader({ conversation, detailsOpen = false, onToggleDetails }: Props) {
  const [renderedAt] = useState(() => Date.now());
  const { user } = useAuth();
  const claim = useClaimConversation();
  const release = useReleaseConversation();
  const close = useCloseConversation();
  const aiControl = useConversationAiControl(conversation.id);
  const aiAutomation = useAiAutomation();
  const members = useAssignableMembers(Boolean(conversation.assigned_to_user_id));
  const channels = useChannelSessions();
  const [reassignOpen, setReassignOpen] = useState(false);
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [continueDialogOpen, setContinueDialogOpen] = useState(false);
  const agents = useAssignableAgents(Boolean(conversation.selected_agent_id || agentDialogOpen));

  const c = conversation.contacts ?? null;
  const displayName = c?.name?.trim() || c?.display_name?.trim() || c?.phone_number || "Sem nome";
  const phone = c?.phone_number ?? null;
  const status = conversation.status;
  const isMineAssigned = conversation.assigned_to_user_id === user.id;
  const isAvailable =
    conversation.assigned_to_user_id == null && !["closed", "archived"].includes(status);
  const aiPaused = Boolean(
    conversation.ai_control_mode === "force_paused" ||
    (conversation.bot_silenced_until &&
      (conversation.bot_silenced_until === "infinity" ||
        new Date(conversation.bot_silenced_until).getTime() > renderedAt)),
  );
  const aiForcedActive = conversation.ai_control_mode === "force_active";
  const humanAttending = conversation.assignee_kind === "user";
  const aiEnabledForAll = aiAutomation.data?.enabled_for_all ?? false;
  const assignee = members.data?.find(
    (member) => member.user_id === conversation.assigned_to_user_id,
  );
  const channel = channels.data?.find((item) => item.id === conversation.channel_session_id);
  const channelName = channel
    ? channel.display_name || channel.phone_number || channel.external_session_name
    : null;
  const channelUnavailable = Boolean(
    channel && !["WORKING", "connected", "active", "online"].includes(channel.status),
  );
  const selectedAgentName = conversation.selected_agent_id
    ? (agents.data?.find((agent) => agent.agent_id === conversation.selected_agent_id)?.name ??
      "Agente manual")
    : "Regra automática";
  const aiStateLabel = aiPaused
    ? "IA pausada nesta conversa"
    : humanAttending
      ? "IA autorizada — aguardando liberação do humano"
      : aiEnabledForAll
        ? "IA automática ligada"
        : aiForcedActive
          ? "IA responderá novas mensagens"
          : "IA desligada nesta conversa";
  const showAiMenu = !aiEnabledForAll || aiPaused;

  return (
    <div className="flex flex-col gap-2 border-b border-border bg-background px-4 py-3">
      <div className="order-2 min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-sm font-semibold">{displayName}</h2>
          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
            {STATUS_LABEL[status] ?? status}
          </Badge>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {phone && (
            <span className="flex items-center gap-1">
              <Phone size={11} weight="regular" aria-hidden /> {phone}
            </span>
          )}
          {channelName && (
            <span title={channel?.phone_number ?? undefined}>
              Recebida em: {channelName}
              {channel?.phone_number && channel.display_name
                ? ` · ${channel.phone_number.slice(-4)}`
                : ""}
            </span>
          )}
          {conversation.assigned_to_user_id && (
            <span>
              Responsável: {assignee?.full_name || (isMineAssigned ? "Você" : "Membro da equipe")}
            </span>
          )}
          {!conversation.assigned_to_user_id && !["closed", "archived"].includes(status) && (
            <span>Responsável: sem responsável</span>
          )}
        </div>
      </div>

      <div className="order-1 flex flex-wrap items-center gap-1.5">
        {channelUnavailable && !c?.is_blocked ? (
          <Button size="sm" variant="outline" onClick={() => setContinueDialogOpen(true)}>
            Continuar em outro número
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => setAgentDialogOpen(true)}>
          Agente: {selectedAgentName}
        </Button>
        {showAiMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant={aiForcedActive ? "default" : "outline"}
                disabled={aiControl.setMode.isPending}
                title="Definir como a IA deve agir somente nesta conversa"
              >
                {aiPaused ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                {aiStateLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 p-1.5">
              <DropdownMenuLabel>
                <span className="block">
                  {aiEnabledForAll
                    ? "Atendimento humano em andamento"
                    : "IA de teste neste contato"}
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {aiEnabledForAll
                    ? "A IA geral está ligada, mas permanece pausada enquanto houver atendimento humano."
                    : "A IA geral está desligada. Ative somente os contatos que deseja testar; isso não inicia follow-up."}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {!aiEnabledForAll ? (
                <DropdownMenuItem
                  className="items-start py-2.5"
                  onSelect={() => aiControl.setMode.mutate("inherit")}
                >
                  <span>
                    <span className="block">Desativar IA neste contato</span>
                    <span className="text-xs text-muted-foreground">
                      Remove a exceção manual e volta para a IA geral desligada.
                    </span>
                  </span>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                className="items-start py-2.5"
                onSelect={() => aiControl.setMode.mutate("force_active")}
              >
                <Play size={14} aria-hidden />
                <span>
                  <span className="block">
                    {aiPaused ? "Devolver para IA" : "Ativar IA somente neste contato"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {humanAttending
                      ? "A IA fica autorizada, mas só responde depois de usar “Liberar atendimento”."
                      : "A IA pode responder aqui. Nenhuma cadência será iniciada."}
                  </span>
                </span>
              </DropdownMenuItem>
              {!aiEnabledForAll ? (
                <DropdownMenuItem
                  className="items-start py-2.5"
                  onSelect={() => aiControl.setMode.mutate("force_paused")}
                >
                  <Pause size={14} aria-hidden />
                  <span>
                    <span className="block">Pausar IA neste contato</span>
                    <span className="text-xs text-muted-foreground">
                      O atendimento fica com a equipe até usar “Devolver para IA”.
                    </span>
                  </span>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            size="sm"
            variant="default"
            disabled
            title="A IA geral está ligada para conversas elegíveis"
          >
            <Play size={14} aria-hidden />
            {aiStateLabel}
          </Button>
        )}
        {isAvailable && (
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
            Pegar para mim
          </Button>
        )}
        {conversation.assigned_to_user_id && !isMineAssigned ? (
          <span className="max-w-44 text-right text-[11px] text-muted-foreground">
            Esta conversa está com outro atendente. Use Transferir se necessário.
          </span>
        ) : null}
        {isMineAssigned && (
          <Button
            size="sm"
            variant="outline"
            title={
              aiForcedActive && !aiPaused
                ? "Remove o atendimento humano e permite que a IA responda"
                : "Remove o responsável humano e devolve a conversa à fila"
            }
            disabled={release.isPending}
            onClick={() => release.mutate({ conversation_id: conversation.id })}
          >
            Liberar atendimento
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
        {onToggleDetails ? (
          <Button size="sm" variant={detailsOpen ? "default" : "outline"} onClick={onToggleDetails}>
            {detailsOpen ? "Fechar detalhes" : "Detalhes do contato"}
          </Button>
        ) : null}
      </div>
      <ReassignDialog
        conversationId={conversation.id}
        open={reassignOpen}
        onOpenChange={setReassignOpen}
      />
      <ConversationAgentDialog
        conversationId={conversation.id}
        currentAgentId={conversation.selected_agent_id}
        currentReason={conversation.agent_selection_reason}
        humanAttending={conversation.assignee_kind === "user"}
        open={agentDialogOpen}
        onOpenChange={setAgentDialogOpen}
      />
      <ContinueConversationDialog
        conversationId={conversation.id}
        open={continueDialogOpen}
        onOpenChange={setContinueDialogOpen}
      />
    </div>
  );
}
