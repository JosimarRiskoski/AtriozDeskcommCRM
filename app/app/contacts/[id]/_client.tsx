"use client";
import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ShieldCheck, PencilSimple, Trash, ChatCircle } from "@/lib/ui/icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useContact } from "@/hooks/contacts/useContact";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { ROLE_RANK } from "@/lib/auth/types";
import { TimelineView } from "@/components/contacts/TimelineView";
import { EditContactDialog } from "@/components/contacts/EditContactDialog";
import { AnonymizeDialog } from "@/components/contacts/AnonymizeDialog";
import { BackNavigation } from "@/components/shell/BackNavigation";
import { StartFollowupCard } from "@/components/contacts/StartFollowupCard";
import { DeleteContactDialog } from "@/components/contacts/DeleteContactDialog";
import { ContactOriginsCard } from "@/components/contacts/ContactOriginsCard";
import { CommunicationPrivacyCard } from "@/components/contacts/CommunicationPrivacyCard";
import { DuplicateContactCard } from "@/components/contacts/DuplicateContactCard";
import { StartContactConversationDialog } from "@/components/contacts/StartContactConversationDialog";

interface Props {
  contactId: string;
}

export function ContactDetailClient({ contactId }: Props) {
  const q = useContact(contactId);
  const { user, activeOrg } = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const [anonOpen, setAnonOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [startConversationOpen, setStartConversationOpen] = useState(false);

  if (q.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <div className="p-6">
        <Card className="p-6 text-center text-sm text-error-fg">Erro ao carregar contato.</Card>
      </div>
    );
  }

  const contact = q.data.data;
  const isAdmin =
    user.is_platform_admin || (activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin);
  const canManageFollowups =
    user.is_platform_admin || (activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager);
  const canDelete = canManageFollowups;

  // O nome editado pela equipe e a fonte da verdade. `display_name` e apenas
  // o nome informado pelo WhatsApp e pode vir contaminado em eventos fromMe.
  const displayName = contact.name?.trim() || contact.display_name?.trim() || "Sem nome";

  return (
    <div className="space-y-4 p-6">
      <nav
        aria-label="Navegação estrutural"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <BackNavigation fallbackHref="/app/contacts" />
        <span aria-hidden>/</span>
        <span>Contatos</span>
        <span aria-hidden>/</span>
        <span className="truncate text-foreground">{displayName}</span>
      </nav>
      {contact.is_anonymized && (
        <div
          role="alert"
          className="border-error-fg/30 sticky top-0 z-20 flex items-center gap-3 rounded-md border bg-error-bg p-3 text-sm text-error-fg"
        >
          <ShieldCheck size={18} weight="duotone" aria-hidden />
          <span>
            Contato anonimizado (LGPD)
            {contact.anonymized_at &&
              ` em ${format(new Date(contact.anonymized_at), "dd/MM/yyyy", { locale: ptBR })}`}
            {" — edição bloqueada."}
          </span>
        </div>
      )}

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{displayName}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {contact.email && <span>{contact.email}</span>}
            {contact.email && contact.phone_number && <span>•</span>}
            {contact.phone_number && <span>{contact.phone_number}</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {contact.tags.map((t) => (
              <Badge key={t} variant="neutral">
                {t}
              </Badge>
            ))}
            {contact.is_blocked && (
              <Badge
                variant="warning"
                title={
                  contact.blocked_reason === "stop_keyword"
                    ? "O CRM identificou um pedido para interromper mensagens"
                    : contact.blocked_reason || "Envios bloqueados no CRM"
                }
              >
                Bloqueado no CRM
              </Badge>
            )}
            {contact.is_anonymized && <Badge variant="destructive">Anonimizado</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!contact.is_anonymized && !contact.is_blocked && contact.phone_number ? (
            <Button onClick={() => setStartConversationOpen(true)}>
              <ChatCircle size={16} weight="bold" aria-hidden />
              <span>Iniciar conversa</span>
            </Button>
          ) : null}
          {!contact.is_anonymized && (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <PencilSimple size={16} weight="bold" aria-hidden />
              <span>Editar</span>
            </Button>
          )}
          {canDelete && (
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash size={16} weight="bold" aria-hidden />
              <span>Excluir</span>
            </Button>
          )}
        </div>
      </header>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Visão geral</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          {isAdmin && <TabsTrigger value="lgpd">LGPD</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="space-y-4">
            <Card className="p-4">
              <dl className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Nome</dt>
                  <dd className="mt-1">{contact.name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Display name</dt>
                  <dd className="mt-1">{contact.display_name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Email</dt>
                  <dd className="mt-1">{contact.email ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Telefone</dt>
                  <dd className="mt-1">{contact.phone_number ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Empresa</dt>
                  <dd className="mt-1">{contact.company ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Cidade / UF</dt>
                  <dd className="mt-1">
                    {[contact.city, contact.state].filter(Boolean).join(" / ") || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Origem</dt>
                  <dd className="mt-1">{contact.source}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Última atividade</dt>
                  <dd className="mt-1">
                    {contact.last_activity_at
                      ? format(new Date(contact.last_activity_at), "dd/MM/yyyy HH:mm", {
                          locale: ptBR,
                        })
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Criado em</dt>
                  <dd className="mt-1">
                    {format(new Date(contact.created_at), "dd/MM/yyyy", { locale: ptBR })}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Tags</dt>
                  <dd className="mt-1 flex flex-wrap gap-1">
                    {contact.tags.length === 0
                      ? "—"
                      : contact.tags.map((t) => (
                          <Badge key={t} variant="neutral">
                            {t}
                          </Badge>
                        ))}
                  </dd>
                </div>
                {Object.entries(contact.custom_fields ?? {}).map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-xs uppercase text-muted-foreground">
                      {key.replaceAll("_", " ")}
                    </dt>
                    <dd className="mt-1">{value == null ? "—" : String(value)}</dd>
                  </div>
                ))}
              </dl>
            </Card>
            <ContactOriginsCard contactId={contactId} />
            <CommunicationPrivacyCard
              contactId={contactId}
              isBlocked={contact.is_blocked}
              blockedReason={contact.blocked_reason}
              blockedAt={contact.blocked_at}
              canManage={!!isAdmin}
            />
            {canManageFollowups && !contact.is_anonymized ? (
              <DuplicateContactCard contactId={contactId} currentName={displayName} />
            ) : null}
            {canManageFollowups && !contact.is_anonymized && (
              <StartFollowupCard contactId={contactId} />
            )}
          </div>
        </TabsContent>

        <TabsContent value="timeline" className="mt-4">
          <TimelineView contactId={contactId} />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="lgpd" className="mt-4">
            <Card className="space-y-4 p-4">
              <div>
                <h2 className="text-lg font-semibold">Direito ao esquecimento (LGPD)</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  A anonimização é irreversível. Use somente após confirmação formal do titular ou
                  ordem judicial.
                </p>
              </div>
              {contact.is_anonymized ? (
                <p className="text-sm text-muted-foreground">
                  Este contato já foi anonimizado
                  {contact.anonymized_at &&
                    ` em ${format(new Date(contact.anonymized_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}`}
                  .
                </p>
              ) : (
                <Button variant="destructive" onClick={() => setAnonOpen(true)}>
                  Anonimizar contato
                </Button>
              )}
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <EditContactDialog contact={contact} open={editOpen} onOpenChange={setEditOpen} />
      <AnonymizeDialog contactId={contactId} open={anonOpen} onOpenChange={setAnonOpen} />
      <DeleteContactDialog
        contactId={contactId}
        contactName={displayName}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
      <StartContactConversationDialog
        contactId={contactId}
        contactName={displayName}
        open={startConversationOpen}
        onOpenChange={setStartConversationOpen}
      />
    </div>
  );
}
