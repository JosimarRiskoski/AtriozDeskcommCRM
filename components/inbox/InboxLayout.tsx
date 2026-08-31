"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useClaimConversation } from "@/hooks/inbox/useClaimConversation";
import { useCloseConversation } from "@/hooks/inbox/useCloseConversation";
import {
  useConversationsRealtime,
  type ConversationsFilters,
  type ConversationWithContact,
} from "@/hooks/inbox/useConversationsRealtime";
import { useConversation, isNotFound } from "@/hooks/inbox/useConversation";
import { useMarkConversationRead } from "@/hooks/inbox/useMarkConversationRead";
import { ConversationList } from "./ConversationList";
import { InboxFilters, type InboxFiltersValue, type InboxTab } from "./InboxFilters";
import { ChatThread } from "./ChatThread";
import { Composer, type ComposerHandle } from "./Composer";
import { ConversationHeader } from "./ConversationHeader";
import { RetentionNotice } from "./RetentionNotice";
import { CRMSidePanel } from "./CRMSidePanel";
import { InboxKeyboardShortcuts } from "./InboxKeyboardShortcuts";
import { ShortcutsHelpDialog } from "./ShortcutsHelpDialog";
import { NewContactDialog } from "@/components/contacts/NewContactDialog";
import { Button } from "@/components/ui/button";
import { Plus } from "@/lib/ui/icons";

function tabToFilter(tab: InboxFiltersValue["tab"]): Partial<ConversationsFilters> {
  switch (tab) {
    case "unassigned":
      return { command: "waiting" };
    case "mine":
      return { assigned_to: "me", exclude_finished: true };
    case "closed":
      return { status: "closed" };
    case "ai":
      return { command: "automatic" };
    case "all":
    default:
      return {};
  }
}

const FILTER_TABS: InboxTab[] = ["unassigned", "mine", "all", "closed", "ai"];

/**
 * Lê ?filter= (G4-02, deep-link). ?filter=all é HONRADO mesmo para agent — a
 * lista volta RLS-scoped (a tab só some cosmeticamente); default: fila.
 */
function parseFilterParam(v: string | null): InboxTab {
  return v && FILTER_TABS.includes(v as InboxTab) ? (v as InboxTab) : "unassigned";
}

interface InboxLayoutProps {
  initialSelectedId?: string | null;
}

export function InboxLayout({ initialSelectedId = null }: InboxLayoutProps = {}) {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.orgId ?? null;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parseFilterParam(searchParams.get("filter"));

  // tab vive na URL (?filter=); os demais filtros são estado local de sessão.
  const [aux, setAux] = useState<Omit<InboxFiltersValue, "tab">>({
    search: "",
    onlyUnread: false,
    includeArchivedConnections: false,
  });
  const filterValue: InboxFiltersValue = { tab, ...aux };
  const setFilterValue = useCallback(
    (next: InboxFiltersValue) => {
      if (next.tab !== tab) {
        const params = new URLSearchParams(searchParams);
        params.set("filter", next.tab);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }
      const { tab: _t, ...rest } = next;
      setAux(rest);
    },
    [tab, searchParams, router, pathname],
  );

  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [newContactOpen, setNewContactOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const composerRef = useRef<ComposerHandle | null>(null);

  const filters: ConversationsFilters = useMemo(
    () => ({
      ...tabToFilter(filterValue.tab),
      search: filterValue.search || undefined,
      channel_session_id: filterValue.channel_session_id,
      include_archived_connections: filterValue.includeArchivedConnections,
      tag: filterValue.tag,
    }),
    [
      filterValue.tab,
      filterValue.search,
      filterValue.channel_session_id,
      filterValue.includeArchivedConnections,
      filterValue.tag,
    ],
  );

  const clientFilter = useMemo(
    () =>
      filterValue.onlyUnread
        ? (c: ConversationWithContact) => (c.unread_count_for_assignee ?? 0) > 0
        : undefined,
    [filterValue.onlyUnread],
  );

  // We need the selected conversation object for header / composer / side panel.
  // Source it from the same query the list uses to avoid an extra request.
  const listQ = useConversationsRealtime(filters, orgId);
  const inList = useMemo(() => {
    const all = listQ.data?.pages.flatMap((p) => p.data) ?? [];
    return all.find((c) => c.id === selectedId) ?? null;
  }, [listQ.data, selectedId]);

  // Deep-link para conversa fora do filtro atual (ou fora do escopo do agent):
  // busca única RLS-scoped. 404/vazio ⇒ inacessível ⇒ estado vazio claro (GAP D),
  // nunca stack trace. A RLS (G4-01) é quem garante o não-vazamento.
  // A lista usa um payload mínimo para não multiplicar o Egress. Ao selecionar,
  // buscamos o registro completo (consentimento, metadados e contexto lateral).
  const needsFetch = !!selectedId;
  const single = useConversation(selectedId, needsFetch);
  const selectedConversation: ConversationWithContact | null = single.data ?? inList ?? null;
  const selectionNotFound =
    needsFetch && !single.isPending && !single.data && isNotFound(single.error);

  // O filtro também governa o painel aberto. Manter uma conversa de outro
  // número visível enquanto o seletor mostra a conexão escolhida induz o
  // atendente a acreditar que responderá pelo canal errado.
  useEffect(() => {
    if (!selectedConversation) return;
    const outsideSelectedChannel =
      !!filterValue.channel_session_id &&
      selectedConversation.channel_session_id !== filterValue.channel_session_id;
    const belongsToArchivedConnection = Boolean(
      selectedConversation.channel_sessions?.archived_at && !filterValue.includeArchivedConnections,
    );
    if (outsideSelectedChannel || belongsToArchivedConnection) {
      setSelectedId(null);
      setDetailsOpen(false);
    }
  }, [
    selectedConversation,
    filterValue.channel_session_id,
    filterValue.includeArchivedConnections,
  ]);

  const claim = useClaimConversation();
  const close = useCloseConversation();
  const markRead = useMarkConversationRead();
  const requestedReadIds = useRef(new Set<string>());

  const requestRead = useCallback(
    (conversation: ConversationWithContact | null | undefined) => {
      if (!conversation || conversation.unread_count_for_assignee <= 0) return;
      if (requestedReadIds.current.has(conversation.id)) return;
      requestedReadIds.current.add(conversation.id);
      markRead.mutate(conversation.id, {
        onError: () => requestedReadIds.current.delete(conversation.id),
      });
    },
    [markRead],
  );

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      const conversation = listQ.data?.pages
        .flatMap((page) => page.data)
        .find((item) => item.id === id);
      requestRead(conversation);
    },
    [listQ.data, requestRead],
  );
  useEffect(() => requestRead(selectedConversation), [requestRead, selectedConversation]);
  const handleVisibleChange = useCallback((ids: string[]) => setVisibleIds(ids), []);
  const handleFocusReply = useCallback(() => composerRef.current?.focus(), []);
  const handleClaim = useCallback(() => {
    if (!selectedConversation) return;
    claim.mutate({
      conversation_id: selectedConversation.id,
      expected_assignee: selectedConversation.assigned_to_user_id,
    });
  }, [claim, selectedConversation]);
  const handleClose = useCallback(() => {
    if (!selectedConversation) return;
    close.mutate({ conversation_id: selectedConversation.id });
  }, [close, selectedConversation]);

  const blockedReason = selectedConversation?.contacts?.is_blocked
    ? selectedConversation.contacts.blocked_reason === "stop_keyword"
      ? "Envios bloqueados pelo CRM após identificar um pedido de parada. Confira o contato antes de reativar."
      : `Envios bloqueados no CRM${selectedConversation.contacts.blocked_reason ? `: ${selectedConversation.contacts.blocked_reason}` : "."}`
    : selectedConversation?.contacts?.is_anonymized
      ? "Contato anonimizado — não é possível enviar mensagens."
      : selectedConversation?.channel_sessions?.archived_at
        ? "Esta conexão foi arquivada. O histórico continua disponível, mas novos envios por ela estão bloqueados."
        : null;

  return (
    <div className="relative grid h-full min-h-0 w-full grid-cols-1 overflow-hidden md:grid-cols-[300px_minmax(0,1fr)]">
      <div className="flex h-full min-h-0 flex-col border-r border-border">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">Conversas</span>
          <Button size="sm" variant="outline" onClick={() => setNewContactOpen(true)}>
            <Plus size={15} /> Novo contato/conversa
          </Button>
        </div>
        <InboxFilters value={filterValue} onChange={setFilterValue} />
        <div className="min-h-0 flex-1 overflow-hidden">
          <ConversationList
            filters={filters}
            query={listQ}
            selectedId={selectedId}
            onSelect={handleSelect}
            clientFilter={clientFilter}
            onVisibleChange={handleVisibleChange}
          />
        </div>
      </div>

      <div className="flex h-full min-h-0 flex-col">
        {selectedConversation ? (
          <>
            <ConversationHeader
              conversation={selectedConversation}
              detailsOpen={detailsOpen}
              onToggleDetails={() => setDetailsOpen((open) => !open)}
            />
            <div className="min-h-0 flex-1 overflow-hidden">
              <ChatThread conversationId={selectedConversation.id} />
            </div>
            <RetentionNotice conversationId={selectedConversation.id} />
            <Composer
              ref={composerRef}
              conversationId={selectedConversation.id}
              blockedReason={blockedReason}
              disabled={selectedConversation.status === "closed"}
              // Alguns contatos recebidos pelo WhatsApp possuem apenas
              // display_name. Para templates, ele é um nome válido e deve
              // preencher {{nome}}/{{primeiro_nome}} da mesma forma.
              contactName={
                selectedConversation.contacts?.name ||
                selectedConversation.contacts?.display_name ||
                null
              }
            />
          </>
        ) : selectionNotFound ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            Conversa não encontrada ou fora do seu acesso.
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Selecione uma conversa
          </div>
        )}
      </div>

      {detailsOpen ? (
        <aside className="absolute inset-y-0 right-0 z-20 flex w-[min(24rem,92vw)] min-w-[20rem] flex-col border-l border-border bg-background shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold">Detalhes do contato</span>
            <Button size="sm" variant="ghost" onClick={() => setDetailsOpen(false)}>
              Fechar
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <CRMSidePanel conversation={selectedConversation} />
          </div>
        </aside>
      ) : null}

      <InboxKeyboardShortcuts
        visibleIds={visibleIds}
        selectedId={selectedId}
        onSelect={handleSelect}
        onFocusReply={handleFocusReply}
        onClaim={handleClaim}
        onClose={handleClose}
        onToggleHelp={() => setHelpOpen((v) => !v)}
      />
      <NewContactDialog
        open={newContactOpen}
        onOpenChange={setNewContactOpen}
        onConversationStarted={(conversationId) => {
          setSelectedId(conversationId);
          router.push(`/app/inbox/${conversationId}`);
        }}
      />
      <ShortcutsHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
