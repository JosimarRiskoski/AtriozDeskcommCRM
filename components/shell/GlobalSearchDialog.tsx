"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MagnifyingGlass, Users, Kanban, Gear, Inbox, ChatsCircle, FileText } from "@/lib/ui/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GlobalSearchPayload } from "@/app/api/v1/search/route";

type SearchResponse = { data?: GlobalSearchPayload };

const EMPTY_RESULTS: GlobalSearchPayload = {
  contacts: [],
  conversations: [],
  leads: [],
  files: [],
};

const SHORTCUTS = [
  { label: "Inbox", description: "Conversas do WhatsApp", href: "/app/inbox", Icon: Inbox },
  { label: "Kanban", description: "Funis e negócios", href: "/app/kanban", Icon: Kanban },
  { label: "Contatos", description: "Todos os contatos", href: "/app/contacts", Icon: Users },
  { label: "Configurações", description: "Conta e integrações", href: "/app/settings", Icon: Gear },
  { label: "Conexões", description: "WhatsApp, saúde e proteção de envio", href: "/app/connections", Icon: Gear },
  { label: "Radar", description: "Clientes que precisam de atenção", href: "/app/radar", Icon: Kanban },
  { label: "Agentes IA", description: "Configuração, teste e execução dos agentes", href: "/app/ai/agents", Icon: Gear },
  { label: "Follow-ups", description: "Retornos automáticos e modelos prontos", href: "/app/ai/followups", Icon: Inbox },
];

export function GlobalSearchDialog() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchPayload>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const listener = () => setOpen(true);
    window.addEventListener("deskcomm:open-global-search", listener);
    return () => window.removeEventListener("deskcomm:open-global-search", listener);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults(EMPTY_RESULTS);
      setError(null);
      return;
    }
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults(EMPTY_RESULTS);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/v1/search?q=${encodeURIComponent(term)}&limit=6`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Não foi possível concluir a busca.");
        const payload = (await response.json()) as SearchResponse;
        setResults(payload.data ?? EMPTY_RESULTS);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setResults(EMPTY_RESULTS);
        setError(cause instanceof Error ? cause.message : "Falha inesperada na busca.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const visibleShortcuts = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    if (!term) return SHORTCUTS;
    return SHORTCUTS.filter((item) => `${item.label} ${item.description}`.toLocaleLowerCase("pt-BR").includes(term));
  }, [query]);

  const resultCount =
    results.contacts.length + results.conversations.length + results.leads.length + results.files.length;

  const navigate = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[12vh] max-h-[76vh] max-w-2xl translate-y-0 gap-0 overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Busca global</DialogTitle>
          <DialogDescription>Encontre contatos e acesse rapidamente os principais módulos.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <MagnifyingGlass size={20} className="text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar contato, conversa, negócio ou configuração..."
            className="h-11 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            aria-label="Termo da busca global"
          />
          <kbd className="rounded border bg-muted px-2 py-1 text-xs text-muted-foreground">Esc</kbd>
        </div>
        <div className="max-h-[62vh] overflow-y-auto p-3">
          {loading ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">Buscando...</p> : null}
          {error ? <p className="px-3 py-6 text-center text-sm text-destructive">{error}</p> : null}

          {!loading && results.contacts.length > 0 ? (
            <section aria-labelledby="search-contacts-title">
              <h3 id="search-contacts-title" className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Contatos
              </h3>
              {results.contacts.map((contact) => (
                <button
                  key={contact.id}
                  type="button"
                  onClick={() => navigate(`/app/contacts/${contact.id}`)}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Users size={18} className="text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{contact.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{contact.description}</span>
                  </span>
                </button>
              ))}
            </section>
          ) : null}

          {!loading && results.conversations.length > 0 ? (
            <SearchSection
              title="Conversas"
              className="mt-4 border-t pt-3"
              items={results.conversations.map((item) => ({ ...item, href: `/app/inbox/${item.id}` }))}
              Icon={ChatsCircle}
              onNavigate={navigate}
            />
          ) : null}

          {!loading && results.leads.length > 0 ? (
            <SearchSection
              title="Negócios"
              className="mt-4 border-t pt-3"
              items={results.leads.map((item) => ({ ...item, href: `/app/pipelines/${item.pipeline_id}` }))}
              Icon={Kanban}
              onNavigate={navigate}
            />
          ) : null}

          {!loading && results.files.length > 0 ? (
            <SearchSection
              title="Arquivos"
              className="mt-4 border-t pt-3"
              items={results.files.map((item) => ({ ...item, href: `/app/inbox/${item.conversation_id}` }))}
              Icon={FileText}
              onNavigate={navigate}
            />
          ) : null}

          {!loading && visibleShortcuts.length > 0 ? (
            <section aria-labelledby="search-pages-title" className={resultCount ? "mt-4 border-t pt-3" : ""}>
              <h3 id="search-pages-title" className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Módulos
              </h3>
              {visibleShortcuts.map(({ href, label, description, Icon }) => (
                <button
                  key={href}
                  type="button"
                  onClick={() => navigate(href)}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Icon size={18} className="text-muted-foreground" aria-hidden />
                  <span>
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-xs text-muted-foreground">{description}</span>
                  </span>
                </button>
              ))}
            </section>
          ) : null}

          {!loading && !error && query.trim().length >= 2 && resultCount === 0 && visibleShortcuts.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nenhum resultado encontrado.</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SearchSection({
  title,
  className,
  items,
  Icon,
  onNavigate,
}: {
  title: string;
  className?: string;
  items: Array<{ id: string; title: string; description: string; href: string }>;
  Icon: typeof Users;
  onNavigate: (href: string) => void;
}) {
  const sectionId = `search-${title.toLocaleLowerCase("pt-BR").replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={sectionId} className={className}>
      <h3 id={sectionId} className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onNavigate(item.href)}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon size={18} className="text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{item.title}</span>
            <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
          </span>
        </button>
      ))}
    </section>
  );
}
