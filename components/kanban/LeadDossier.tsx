"use client";
import { useRef, useState } from "react";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useLeadTimeline } from "@/hooks/leads/useLeadTimeline";
import { useConversationNotes } from "@/hooks/inbox/useConversationNotes";
import type { Lead } from "@/lib/types/leads";
import { linkedConversationId } from "@/lib/leads/source-conversation";
import { LeadFieldsForm } from "./LeadFieldsForm";
import { ScoreSlot } from "./ScoreSlot";
import { LeadTimeline } from "./LeadTimeline";
import { OwnerBadge } from "./OwnerBadge";
import { resolveLeadOwner } from "@/lib/kanban/owner";
import { AppointmentDialog } from "@/components/calendar/AppointmentDialog";
import { Button } from "@/components/ui/button";
import { CalendarBlank } from "@/lib/ui/icons";
import { MetaConversionControl } from "./MetaConversionControl";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead: Lead;
  pipelineId: string;
  stageName: string;
  ownerNames?: Map<string, string | null>;
  valueLabel: string;
}

function formatBRL(cents: number | null, currency: string | null): string {
  if (cents === null) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency ?? "BRL",
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `R$ ${(cents / 100).toFixed(0)}`;
  }
}

/**
 * O dossiê do negócio: cabeçalho vivo → timeline → campos.
 *
 * A ORDEM É a mudança em relação ao diálogo de edição: quem abre um lead quer
 * primeiro saber O QUE ACONTECEU, e só depois mexer. O formulário íntegro fica
 * por último, e o cabeçalho tem um atalho para ele — ordem preservada, custo de
 * rolagem resolvido.
 *
 * SALVAR NÃO FECHA. Quem edita precisa ver a atividade que acabou de gerar
 * entrar na timeline; fechar esconderia o registro justamente de quem o
 * produziu, e a funcionalidade que prova "sua ação fica registrada" provaria
 * isso para todo mundo menos para o autor.
 */
export function LeadDossier({
  open,
  onOpenChange,
  lead,
  pipelineId,
  stageName,
  ownerNames,
  valueLabel,
}: Props) {
  const campos = useRef<HTMLDivElement | null>(null);
  const timeline = useLeadTimeline(open ? lead.id : null, lead.contact_id);
  const conversationId = linkedConversationId(lead.source_metadata);
  const conversationNotes = useConversationNotes(open ? conversationId : null);
  const owner = resolveLeadOwner(lead, ownerNames);
  const score = lead.score ?? null;
  const [appointmentOpen, setAppointmentOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md"
        // Observável pelo mesmo motivo do board: "a assinatura morreu" e "nada
        // aconteceu" têm a mesma aparência, que é silêncio.
        data-realtime-status={timeline.realtimeStatus.toLowerCase()}
        // Observável como no board: "a entrega morreu" e "nada aconteceu"
        // têm a mesma aparência, e no dossiê a segunda é ainda mais crível —
        // negócio sem novidade é um estado normal.
        data-refetch-divergencias={timeline.seguranca.divergencias}
      >
        <SheetHeader className="pb-3">
          <SheetTitle className="text-base leading-6">{lead.title}</SheetTitle>
        </SheetHeader>

        {/* ① cabeçalho vivo */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border pb-3 text-xs">
          <span className="font-medium tabular-nums text-text">
            {valueLabel}: {formatBRL(lead.value_cents, lead.currency)}
          </span>
          <span className="text-text-muted">{stageName}</span>
          <OwnerBadge
            ownerKind={owner.kind}
            ownerName={owner.name}
            agentVersion={owner.agentVersion}
          />
          {score && (
            // O MESMO componente do card, não uma cópia do medidor.
            // "Superfície nova herda as decisões da antiga" só vale como
            // mecanismo: herdar por cópia é como as duas listas do evidence —
            // funciona hoje e diverge no mês em que alguém mudar um dos dois.
            // De brinde, o rótulo honesto da âncora ("registro que sustenta",
            // nunca "momento da conversa") vem junto, sem eu reescrever nada.
            <ScoreSlot
              probability={score.probability}
              band={score.band}
              reason={score.reason}
              factors={score.factors.slice(0, 3)}
            />
          )}

          {lead.contact_id ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => setAppointmentOpen(true)}
            >
              <CalendarBlank size={13} className="mr-1" /> Agendar
            </Button>
          ) : null}

          <MetaConversionControl leadId={lead.id} />

          <button
            type="button"
            onClick={() => campos.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="ml-auto text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            Editar dados do negócio
          </button>
        </div>

        {/* O score NÃO aparece na timeline: recálculo é telemetria e não emite
            atividade (silêncio para telemetria, pulso para mudança de estado).
            Sem esta linha, quem visse o número mudando no cabeçalho e nunca na
            timeline concluiria que a timeline está incompleta. */}
        {score?.at && (
          <p className="pt-2 text-[11px] text-text-muted">
            Probabilidade recalculada automaticamente · {new Date(score.at).toLocaleString("pt-BR")}
          </p>
        )}

        {/* ② timeline */}
        <section className="flex-1 py-3">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
            Linha do tempo
          </h3>
          <LeadTimeline
            itens={timeline.itens}
            chegouAoVivo={timeline.chegouAoVivo}
            isLoading={timeline.isLoading}
            isError={timeline.isError}
          />
        </section>

        {conversationId && conversationNotes.length > 0 ? (
          <section className="border-t border-border py-3">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
              Notas internas da conversa
            </h3>
            <div className="space-y-2">
              {conversationNotes.map((note) => (
                <div key={note.id} className="rounded-md border border-warning/40 bg-warning-bg px-3 py-2 text-sm text-warning-fg">
                  <p className="whitespace-pre-wrap break-words">{note.body}</p>
                  <p className="mt-1 text-[11px] opacity-75">
                    {note.created_by_name ?? "Equipe"} · {new Date(note.created_at).toLocaleString("pt-BR")}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* ③ campos, por último */}
        <div ref={campos} className="border-t border-border pt-3">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
            Dados do negócio
          </h3>
          <LeadFieldsForm lead={lead} pipelineId={pipelineId} valueLabel={valueLabel} />
        </div>
        {lead.contact_id ? (
          <AppointmentDialog
            open={appointmentOpen}
            onOpenChange={setAppointmentOpen}
            contactId={lead.contact_id}
            leadId={lead.id}
            contactName={lead.title}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
