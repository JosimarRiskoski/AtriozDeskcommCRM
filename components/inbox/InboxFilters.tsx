"use client";
import { useEffect, useRef, useState } from "react";
import { MagnifyingGlass } from "@/lib/ui/icons";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useChannelSessions } from "@/hooks/channels/useChannelSessions";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useConversationTagVocabulary } from "@/hooks/inbox/useConversationTags";
import { useConversationCounts } from "@/hooks/inbox/useConversationCounts";
import type { Role, VisibilityMode } from "@/lib/auth/types";

export type InboxTab = "unassigned" | "mine" | "all" | "closed" | "ai";

const INBOX_TABS: { value: InboxTab; label: string }[] = [
  { value: "unassigned", label: "Fila" },
  { value: "mine", label: "Minhas" },
  { value: "all", label: "Todas" },
  { value: "closed", label: "Fechadas" },
  { value: "ai", label: "Automático" },
];

/**
 * Visões visíveis por papel + escopo (G4-02, acceptance 1). 'Todas' fica oculta
 * para `agent` quando visibility_mode ≠ 'all'; viewer/manager/admin sempre veem.
 * É apenas cosmético — a RLS (G4-01) é quem garante o escopo mesmo via ?filter=all.
 */
export function visibleInboxTabs(role: Role, mode: VisibilityMode | undefined): InboxTab[] {
  const hideAll = role === "agent" && mode !== "all";
  return INBOX_TABS.filter((t) => !(t.value === "all" && hideAll)).map((t) => t.value);
}

export interface InboxFiltersValue {
  tab: InboxTab;
  search: string;
  onlyUnread: boolean;
  includeArchivedConnections: boolean;
  channel_session_id?: string;
  tag?: string;
}

interface Props {
  value: InboxFiltersValue;
  onChange: (next: InboxFiltersValue) => void;
}

export function InboxFilters({ value, onChange }: Props) {
  const [searchInput, setSearchInput] = useState(value.search);
  const { data: channels } = useChannelSessions({
    refetchInterval: 30_000,
    includeArchived: true,
  });
  const { activeOrg } = useAuth();
  const { data: tagVocabulary } = useConversationTagVocabulary(activeOrg?.orgId ?? null);
  const { data: counts } = useConversationCounts(activeOrg?.orgId ?? null);

  const tabs = activeOrg
    ? visibleInboxTabs(activeOrg.role, activeOrg.visibility_mode)
    : INBOX_TABS.map((t) => t.value);
  const countFor: Partial<Record<InboxTab, number>> = {
    unassigned: counts?.unassigned,
    mine: counts?.mine,
    all: counts?.all,
    ai: counts?.automatic,
  };
  // Alternador só aparece com 2+ números — com um só não há o que alternar.
  const activeChannels = (channels ?? []).filter((channel) => !channel.archived_at);
  const archivedChannels = (channels ?? []).filter((channel) => channel.archived_at);
  const visibleChannels = value.includeArchivedConnections ? (channels ?? []) : activeChannels;
  const showChannelSwitch = visibleChannels.length >= 2 || value.includeArchivedConnections;
  const initialChannelApplied = useRef(false);

  // A mesma consulta que abastece o seletor define a conexão inicial. Assim o
  // Inbox não depende de uma segunda leitura das sessões. Depois da primeira
  // escolha, a seleção manual do operador sempre prevalece.
  useEffect(() => {
    if (initialChannelApplied.current || activeChannels.length === 0) return;
    const preferred = activeChannels.find((channel) => channel.is_default) ?? activeChannels[0];
    initialChannelApplied.current = true;
    if (!value.channel_session_id && preferred) {
      onChange({ ...value, channel_session_id: preferred.id });
    }
  }, [activeChannels, onChange, value]);

  // Debounce search input → propagate to parent.
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== value.search) {
        onChange({ ...value, search: searchInput });
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  return (
    <div className="space-y-3 border-b border-border bg-background px-3 py-3">
      <div className="relative">
        <MagnifyingGlass
          size={14}
          weight="regular"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar mensagens…"
          className="h-8 pl-8 text-sm"
          aria-label="Buscar conversas"
        />
      </div>

      {showChannelSwitch && (
        <Select
          value={value.channel_session_id ?? "all"}
          onValueChange={(v) =>
            onChange({ ...value, channel_session_id: v === "all" ? undefined : v })
          }
        >
          <SelectTrigger className="h-8 text-sm" aria-label="Filtrar por número de WhatsApp">
            <SelectValue placeholder="Todos os números" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os números</SelectItem>
            {visibleChannels.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: c.display_color }}
                    aria-hidden
                  />
                  {c.display_name || c.phone_number || c.external_session_name}
                  {c.archived_at ? " (arquivada)" : ""}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {archivedChannels.length > 0 ? (
        <div className="flex items-center justify-between">
          <Label htmlFor="include-archived-connections" className="text-xs text-muted-foreground">
            Incluir conexões arquivadas
          </Label>
          <Switch
            id="include-archived-connections"
            checked={value.includeArchivedConnections}
            onCheckedChange={(checked) =>
              onChange({
                ...value,
                includeArchivedConnections: checked,
                channel_session_id:
                  !checked &&
                  channels?.find((channel) => channel.id === value.channel_session_id)?.archived_at
                    ? undefined
                    : value.channel_session_id,
              })
            }
          />
        </div>
      ) : null}

      {(tagVocabulary?.length ?? 0) > 0 && (
        <Select
          value={value.tag ?? "all"}
          onValueChange={(v) => onChange({ ...value, tag: v === "all" ? undefined : v })}
        >
          <SelectTrigger className="h-8 text-sm" aria-label="Filtrar por tag">
            <SelectValue placeholder="Todas as tags" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as tags</SelectItem>
            {tagVocabulary?.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Tabs value={value.tab} onValueChange={(v) => onChange({ ...value, tab: v as InboxTab })}>
        <TabsList
          className="grid h-8 w-full"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        >
          {tabs.map((tab) => {
            const meta = INBOX_TABS.find((t) => t.value === tab)!;
            const count = countFor[tab];
            return (
              <TabsTrigger key={tab} value={tab} className="gap-1 text-[11px]">
                {meta.label}
                {typeof count === "number" && count > 0 && (
                  <span className="text-[10px] tabular-nums text-muted-foreground">{count}</span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      <div className="flex items-center justify-between">
        <Label htmlFor="only-unread" className="text-xs text-muted-foreground">
          Apenas não lidos
        </Label>
        <Switch
          id="only-unread"
          checked={value.onlyUnread}
          onCheckedChange={(v) => onChange({ ...value, onlyUnread: v })}
        />
      </div>
    </div>
  );
}
