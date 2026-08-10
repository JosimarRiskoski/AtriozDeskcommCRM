"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tag, Receipt, Briefcase, ArrowRight } from "@/lib/ui/icons";
import { apiClient } from "@/lib/api/client";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";
import { activityLabel, actorLabel, actorShape } from "@/lib/leads/activity-vocabulary";
import { ConversationTagsEditor } from "./ConversationTagsEditor";
import { cn } from "@/lib/utils";
import { StartFollowupCard } from "@/components/contacts/StartFollowupCard";
import { CreateHumanCaseDialog } from "@/components/inbox/CreateHumanCaseDialog";
import { AIConversationContextCard } from "@/components/inbox/AIConversationContextCard";
import { OpenHumanCaseCard } from "@/components/inbox/OpenHumanCaseCard";
import { useChannelSessions } from "@/hooks/channels/useChannelSessions";
import { useConversationNotes } from "@/hooks/inbox/useConversationNotes";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { contactSourceLabel } from "@/lib/contacts/source-labels";
import { NewLeadDialog } from "@/components/kanban/NewLeadDialog";
import type { BoardData } from "@/lib/kanban/types";
import type { PipelineRow } from "@/app/api/v1/pipelines/_handler";

interface Props {
  conversation: ConversationWithContact | null;
}

interface LeadRow {
  id: string;
  pipeline_id: string;
  stage_id: string;
  title: string;
  status: string;
  value_cents: number | null;
  currency: string | null;
  updated_at: string;
  owner_user_id: string | null;
  crm_stages: { name: string } | null;
}

interface SourceEvent {
  id: string;
  source: string;
  occurred_at: string;
}

interface OrderRow {
  id: string;
  external_id: string | null;
  status: string | null;
  total_cents: number | null;
  currency: string | null;
  created_at: string;
}

interface ActivityRow {
  id: string;
  type: string;
  source_module: string;
  performed_at: string;
  payload: Record<string, unknown> | null;
  /** 0071 — o porquê legível e quem agiu. */
  reason: string | null;
  actor_kind: string | null;
}

function formatMoney(cents: number | null, currency: string | null): string {
  if (cents == null) return "—";
  const cur = currency ?? "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${cur}`;
  }
}

function shortDate(iso: string): string {
  return format(new Date(iso), "dd/MM/yy HH:mm", { locale: ptBR });
}

/**
 * O que cada seção mostra quando não tem lista para mostrar.
 *
 * Peça única porque são TRÊS seções tomando a MESMA decisão — e foi por essa
 * decisão viver repetida em três lugares que as três mentiam juntas.
 *
 * Fora do componente de propósito: declarada dentro do corpo, ela vira um tipo
 * novo a cada render e o React remonta a peça inteira. O linter reprovou, com
 * razão — e eu tinha notado o cheiro e seguido em frente.
 *
 * Erro sem saída também é beco, por isso o botão.
 */
function SemLista({
  vazio,
  erro,
  onTentarDeNovo,
}: {
  vazio: string;
  erro: boolean;
  onTentarDeNovo: () => void;
}) {
  if (!erro) return <p className="mt-2 text-xs text-muted-foreground">{vazio}</p>;
  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs text-error-fg">Não consegui ler estes dados.</p>
      <Button size="sm" variant="outline" onClick={onTentarDeNovo}>
        Tentar de novo
      </Button>
    </div>
  );
}

export function CRMSidePanel({ conversation }: Props) {
  const contact = conversation?.contacts ?? null;
  const contactId = contact?.id ?? null;

  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [activities, setActivities] = useState<ActivityRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  /**
   * O TERCEIRO ESTADO. Antes existiam dois — carregando e "tem N itens" — e a
   * falha era traduzida para lista vazia, virando "Sem leads.": uma afirmação
   * sobre o NEGÓCIO feita em cima de um erro de leitura. Distinguir "não tem"
   * de "não consegui ler" é a diferença entre informar e mentir.
   */
  const [erro, setErro] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const [caseDialogOpen, setCaseDialogOpen] = useState(false);
  const [opportunityOpen, setOpportunityOpen] = useState(false);
  const [opportunityPipelineId, setOpportunityPipelineId] = useState("");
  const channels = useChannelSessions();
  const notes = useConversationNotes(conversation?.id ?? null);
  const members = useAssignableMembers(true);
  const origins = useQuery({
    queryKey: ["contact-origins", contactId, "inbox"],
    enabled: !!contactId,
    queryFn: async () =>
      (await apiClient.get<{ data: SourceEvent[] }>(`/api/v1/contacts/${contactId}/origins`)).data,
  });
  const pipelines = useQuery({
    queryKey: ["pipelines", "inbox-opportunity"],
    enabled: opportunityOpen,
    queryFn: async () =>
      (await apiClient.get<{ data: PipelineRow[] }>("/api/v1/pipelines")).data,
  });
  const pipelineId =
    opportunityPipelineId ||
    pipelines.data?.find((pipeline) => pipeline.is_default)?.id ||
    pipelines.data?.[0]?.id ||
    "";
  const board = useQuery({
    queryKey: ["board", pipelineId, "inbox-opportunity"],
    enabled: opportunityOpen && !!pipelineId,
    queryFn: async () =>
      (await apiClient.get<{ data: BoardData }>(`/api/v1/pipelines/${pipelineId}/board`)).data,
  });

  useEffect(() => {
    if (!contactId) {
      setLeads(null);
      setOrders(null);
      setActivities(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErro(false);

    // Pela ROTA, não pelo cliente de navegador: o cookie de sessão é httpOnly,
    // então o supabase-js do browser não vê a sessão e consultava como `anon`
    // (medido: role=anon com gerente logado). Ver o cabeçalho da rota.
    async function load() {
      try {
        const r = await apiClient.get<{
          data: { leads: LeadRow[]; orders: OrderRow[]; activities: ActivityRow[] };
        }>(`/api/v1/contacts/${contactId}/crm-summary`);
        if (cancelled) return;
        setLeads(r.data.leads);
        setOrders(r.data.orders);
        setActivities(r.data.activities);
      } catch {
        if (cancelled) return;
        // Falha NÃO vira lista vazia. Os dados ficam `null` e o painel diz que
        // não conseguiu ler — nunca que não há.
        setErro(true);
        setLeads(null);
        setOrders(null);
        setActivities(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [contactId, tentativa]);

  const tags = contact?.tags ?? [];
  const displayName =
    contact?.name?.trim() || contact?.display_name?.trim() || contact?.phone_number || "—";
  const channel = channels.data?.find((item) => item.id === conversation?.channel_session_id);
  const incomplete = contact?.source_metadata?.cadastro_incompleto === true;
  const consentStatus =
    typeof contact?.consent?.status === "string" ? contact.consent.status : "não informado";

  // `erro` PRIMEIRO, e não é detalhe: as três listas voltam a `null` quando a
  // leitura falha, e este derivado lê `null` como "ainda não chegou". Sem esta
  // guarda o painel mostraria esqueleto para sempre e o estado de falha nunca
  // apareceria — o mesmo colapso de significados que criou o defeito original,
  // só que trocando "erro→vazio" por "erro→carregando".
  const openLeads = (leads ?? []).filter((lead) => lead.status === "open");
  const sectionsLoading = useMemo(
    () => !erro && (loading || (leads === null && orders === null && activities === null)),
    [erro, loading, leads, orders, activities],
  );

  if (!conversation) {
    return (
      <aside className="flex h-full items-center justify-center border-l border-border p-4 text-center text-xs text-muted-foreground">
        Selecione uma conversa para ver detalhes do contato.
      </aside>
    );
  }

  return (
    <aside className="flex h-full flex-col gap-4 overflow-y-auto border-l border-border bg-background p-4">
      <details open>
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Contato e canal
        </summary>
        <Card className="mt-2 space-y-2 p-3 text-sm">
          <div className="font-medium">{displayName}</div>
          {contact?.phone_number && (
            <div className="text-xs text-muted-foreground">{contact.phone_number}</div>
          )}
          {contact?.source && (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">Origem</span>
              <Badge variant="outline" className="max-w-[11rem] truncate">
                {contact.source}
              </Badge>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Cadastro</span>
            <Badge variant={incomplete ? "warning" : "success"}>
              {incomplete ? "Incompleto" : "Identificado"}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Conexão da conversa</span>
            <span className="text-right">
              {channel?.display_name || channel?.phone_number || "Não identificada"}
              {channel?.phone_number ? ` · ${channel.phone_number.slice(-4)}` : ""}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Consentimento</span>
            <span>{consentStatus}</span>
          </div>
          {contact?.is_blocked && (
            <div className="rounded-md border border-warning bg-warning-bg p-2 text-xs text-warning-fg">
              <div className="font-medium">Envios bloqueados no CRM</div>
              <div>
                {contact.blocked_reason === "stop_keyword"
                  ? "O sistema identificou um pedido para interromper mensagens."
                  : contact.blocked_reason || "Motivo não informado."}
              </div>
              {contact.blocked_at && (
                <div className="mt-1 text-[11px]">
                  Desde {new Date(contact.blocked_at).toLocaleString("pt-BR")}
                </div>
              )}
            </div>
          )}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <Badge key={t} variant="secondary" className="h-4 px-1.5 text-[10px]">
                  {t}
                </Badge>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
              <Tag size={12} className="mr-1" weight="regular" aria-hidden /> Tag
            </Button>
            {openLeads.length === 1 ? (
              <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
                <Link href={`/app/pipelines/${openLeads[0]!.pipeline_id}`}>
                  <Briefcase size={12} className="mr-1" weight="regular" aria-hidden />
                  Abrir oportunidade
                </Link>
              </Button>
            ) : openLeads.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
                    <Briefcase size={12} className="mr-1" weight="regular" aria-hidden />
                    Abrir oportunidades
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {openLeads.map((lead) => (
                    <DropdownMenuItem key={lead.id} asChild>
                      <Link href={`/app/pipelines/${lead.pipeline_id}`}>{lead.title}</Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => setOpportunityOpen(true)}
              >
                <Briefcase size={12} className="mr-1" weight="regular" aria-hidden />
                Criar oportunidade
              </Button>
            )}
            {contactId && (
              <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                <Link href={`/app/contacts/${contactId}`}>
                  Abrir contato completo
                  <ArrowRight size={12} className="ml-1" weight="regular" aria-hidden />
                </Link>
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => setCaseDialogOpen(true)}
            >
              Criar caso humano
            </Button>
            <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
              <Link href="/app/ai/cases">Ver casos abertos</Link>
            </Button>
          </div>
        </Card>
      </details>

      <details>
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Histórico de origens
        </summary>
        <Card className="mt-2 space-y-2 p-3 text-xs">
          {origins.isLoading ? <p className="text-muted-foreground">Carregando…</p> : null}
          {(origins.data ?? []).length === 0 && !origins.isLoading ? (
            <p className="text-muted-foreground">Nenhuma origem registrada.</p>
          ) : null}
          {(origins.data ?? [])
            .slice(-5)
            .reverse()
            .map((event) => (
              <div
                key={event.id}
                className="flex items-center justify-between gap-2 border-b py-1 last:border-0"
              >
                <span>{contactSourceLabel(event.source)}</span>
                <time className="text-muted-foreground">
                  {new Date(event.occurred_at).toLocaleDateString("pt-BR")}
                </time>
              </div>
            ))}
        </Card>
      </details>

      <details>
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Observações internas ({notes.length})
        </summary>
        <Card className="mt-2 space-y-2 p-3 text-xs">
          {notes.length ? (
            notes
              .slice(-3)
              .reverse()
              .map((note) => (
                <p key={note.id} className="whitespace-pre-wrap border-b pb-2 last:border-0">
                  {note.body}
                </p>
              ))
          ) : (
            <p className="text-muted-foreground">Nenhuma observação interna.</p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Visível somente à equipe; não é enviada automaticamente à IA.
          </p>
        </Card>
      </details>

      <OpenHumanCaseCard conversationId={conversation.id} />

      <Separator />

      {contactId && (
        <>
          <StartFollowupCard contactId={contactId} compact />
          <Separator />
        </>
      )}

      <ConversationTagsEditor
        conversationId={conversation.id}
        orgId={conversation.organization_id}
        tags={conversation.tags ?? []}
      />

      <Separator />

      <AIConversationContextCard conversationId={conversation.id} />

      <Separator />

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Oportunidades recentes
        </h3>
        {sectionsLoading ? (
          <Skeleton className="mt-2 h-14 w-full" />
        ) : leads && leads.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {leads.map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between rounded-md border border-border p-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{l.title}</div>
                  <div className="text-muted-foreground">
                    {l.crm_stages?.name || l.status} · {formatMoney(l.value_cents, l.currency)}
                    {l.owner_user_id
                      ? ` · ${members.data?.find((member) => member.user_id === l.owner_user_id)?.full_name || "Responsável definido"}`
                      : " · Sem responsável"}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <SemLista
            vazio="Sem oportunidades."
            erro={erro}
            onTentarDeNovo={() => setTentativa((n) => n + 1)}
          />
        )}
      </section>

      <Separator />

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Pedidos recentes
        </h3>
        {sectionsLoading ? (
          <Skeleton className="mt-2 h-14 w-full" />
        ) : orders && orders.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {orders.map((o) => (
              <li
                key={o.id}
                className="flex items-center justify-between rounded-md border border-border p-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1 truncate font-medium">
                    <Receipt size={11} weight="regular" aria-hidden />
                    {o.external_id ?? o.id.slice(0, 8)}
                  </div>
                  <div className="text-muted-foreground">
                    {o.status ?? "—"} · {formatMoney(o.total_cents, o.currency)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <SemLista
            vazio="Sem pedidos."
            erro={erro}
            onTentarDeNovo={() => setTentativa((n) => n + 1)}
          />
        )}
      </section>

      <Separator />

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Atividade
        </h3>
        {sectionsLoading ? (
          <Skeleton className="mt-2 h-14 w-full" />
        ) : activities && activities.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {activities.map((a) => (
              <li key={a.id} className="rounded-md border border-border p-2 text-xs">
                {/* Rótulo do vocabulário único (activity-vocabulary), nunca o
                    tipo cru: a tela e o banco divergiram justamente por manter
                    duas listas. Marcador por ator, forma e não cor (§5). */}
                <div className="flex items-center gap-1.5 font-medium">
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0",
                      actorShape(a.actor_kind) === "filled" && "rounded-full bg-accent",
                      actorShape(a.actor_kind) === "ring" &&
                        "rounded-full border border-accent bg-surface",
                      actorShape(a.actor_kind) === "dashed" &&
                        "rounded-full border border-dashed border-border-strong",
                    )}
                    aria-hidden
                  />
                  {activityLabel(a.type)}
                </div>
                {a.reason && (
                  <div className="mt-0.5 truncate text-muted-foreground">{a.reason}</div>
                )}
                <div className="text-muted-foreground">
                  {actorLabel(a.actor_kind)} · {shortDate(a.performed_at)}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <SemLista
            vazio="Sem atividade."
            erro={erro}
            onTentarDeNovo={() => setTentativa((n) => n + 1)}
          />
        )}
      </section>
      <CreateHumanCaseDialog
        conversationId={conversation.id}
        contactName={displayName}
        open={caseDialogOpen}
        onOpenChange={setCaseDialogOpen}
      />
      <NewLeadDialog
        open={opportunityOpen}
        onOpenChange={setOpportunityOpen}
        pipelineId={pipelineId}
        stages={board.data?.stages ?? []}
        valueLabel={board.data?.pipeline.settings?.value_label as string | undefined}
        contactId={contactId}
        conversationId={conversation.id}
        contactName={displayName === "—" ? null : displayName}
        contactPhone={contact?.phone_number ?? null}
        primaryOrigin={contact?.source ? contactSourceLabel(contact.source) : null}
        originHistory={(origins.data ?? [])
          .slice(-5)
          .reverse()
          .map((event) => contactSourceLabel(event.source))}
        initialTitle={displayName === "—" ? "Nova oportunidade" : displayName}
        source="inbox"
        pipelineOptions={(pipelines.data ?? []).map((pipeline) => ({
          id: pipeline.id,
          name: pipeline.name,
        }))}
        onPipelineChange={setOpportunityPipelineId}
        onCreated={() => setTentativa((value) => value + 1)}
      />
    </aside>
  );
}
