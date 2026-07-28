"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MagnifyingGlass, Users, Kanban, Gear, Inbox } from "@/lib/ui/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Contact } from "@/lib/types/contacts";

type ContactResponse = { data?: Contact[] };

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

function contactName(contact: Contact) {
  return contact.display_name?.trim() || contact.name?.trim() || contact.phone_number || "Contato sem nome";
}

export function GlobalSearchDialog() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
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
      setContacts([]);
      setError(null);
      return;
    }
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setContacts([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/v1/contacts?search=${encodeURIComponent(term)}&limit=8`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Não foi possível concluir a busca.");
        const payload = (await response.json()) as ContactResponse;
        setContacts(Array.isArray(payload.data) ? payload.data : []);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setContacts([]);
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

          {!loading && contacts.length > 0 ? (
            <section aria-labelledby="search-contacts-title">
              <h3 id="search-contacts-title" className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Contatos
              </h3>
              {contacts.map((contact) => (
                <button
                  key={contact.id}
                  type="button"
                  onClick={() => navigate(`/app/contacts/${contact.id}`)}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Users size={18} className="text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{contactName(contact)}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[contact.phone_number, contact.email].filter(Boolean).join(" · ") || "Sem telefone ou e-mail"}
                    </span>
                  </span>
                </button>
              ))}
            </section>
          ) : null}

          {!loading && visibleShortcuts.length > 0 ? (
            <section aria-labelledby="search-pages-title" className={contacts.length ? "mt-4 border-t pt-3" : ""}>
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

          {!loading && !error && query.trim().length >= 2 && contacts.length === 0 && visibleShortcuts.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nenhum resultado encontrado.</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
