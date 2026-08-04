"use client";
import Link from "next/link";
import { useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCase, useAssignCase } from "@/hooks/ai/useCases";
import { useTeamMembers } from "@/hooks/team/useTeamMembers";
import { STATUS_BADGE_VARIANT, STATUS_LABEL, caseEventLabel } from "@/lib/ai/case-copy";
import { CaseReplyPanel } from "./CaseReplyPanel";

export function CaseDetail({ caseId }: { caseId: string | null }) {
  const { data, isLoading } = useCase(caseId);
  const { data: team } = useTeamMembers();
  const assign = useAssignCase();
  const [nextAssignee, setNextAssignee] = useState("");
  const [assignmentReason, setAssignmentReason] = useState("");

  if (caseId === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 py-16 text-center">
        <p className="text-sm font-medium">Selecione um caso à esquerda</p>
        <p className="text-xs text-muted-foreground">Os detalhes e a resposta aparecem aqui.</p>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{data.contact_name ?? "Contato sem nome"}</h2>
          <p className="text-xs text-muted-foreground">{data.contact_phone ?? "Sem telefone"}</p>
        </div>
        <div className="flex items-center gap-2">
          {data.source === "guardrail_autofallback" ? (
            <Badge
              variant="neutral"
              title="Aberto automaticamente pelo sistema — a IA prometeu passar pra humano mas não abriu o caso, então o sistema abriu por ela."
            >
              Aberto automaticamente
            </Badge>
          ) : null}
          <Badge variant={STATUS_BADGE_VARIANT[data.status]}>{STATUS_LABEL[data.status]}</Badge>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href={`/app/inbox/${data.conversation_id}`}>Abrir conversa no Inbox</Link>
        </Button>
        {data.contact_id ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/app/contacts/${data.contact_id}`}>Abrir contato</Link>
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-muted-foreground">O que o cliente precisa</p>
          <p className="mt-1 text-sm">{data.summary}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-muted-foreground">Por que a IA travou</p>
          <p className="mt-1 text-sm">{data.blocker}</p>
        </div>
      </div>

      <section className="rounded-lg border border-border p-3">
        <h3 className="text-sm font-semibold">Responsável pelo caso</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Atual: {data.assignee_name ?? "Ainda não atribuído"}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]">
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={nextAssignee}
            onChange={(e) => setNextAssignee(e.target.value)}
          >
            <option value="">Escolha um membro</option>
            {(team?.data ?? [])
              .filter((m) => m.can_receive_human_cases)
              .map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name ?? m.email ?? "Membro"}
                  {m.is_primary_human_case_responder ? " (principal)" : ""}
                </option>
              ))}
          </select>
          <Input
            value={assignmentReason}
            onChange={(e) => setAssignmentReason(e.target.value)}
            placeholder="Motivo da atribuição ou transferência"
          />
          <Button
            size="sm"
            disabled={!nextAssignee || assignmentReason.trim().length < 3 || assign.isPending}
            onClick={async () => {
              if (!caseId) return;
              await assign.mutateAsync({
                id: caseId,
                assignee_user_id: nextAssignee,
                reason: assignmentReason,
              });
              setAssignmentReason("");
            }}
          >
            {data.assignee_user_id ? "Transferir" : "Atribuir"}
          </Button>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <Info label="Prioridade" value={data.urgency ?? "normal"} />
        <Info label="Categoria" value={(data.category ?? "geral").replaceAll("_", " ")} />
        <Info label="Motivo" value={(data.reason_code ?? "não informado").replaceAll("_", " ")} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <ListInfo
          title="Atividades realizadas"
          values={data.activities ?? []}
          empty="Nenhuma atividade registrada."
        />
        <ListInfo
          title="Documentos relacionados"
          values={data.documents ?? []}
          empty="Nenhum documento relacionado."
        />
      </div>

      <CaseReplyPanel caseId={data.id} status={data.status} />

      <div>
        <h3 className="mb-2 text-sm font-semibold">Linha do tempo</h3>
        <ul className="space-y-2">
          {data.events.map((ev) => (
            <li key={ev.id} className="text-xs text-muted-foreground">
              <span className="text-text">{caseEventLabel(ev)}</span>
              {ev.body ? <>: {ev.body}</> : null}
              {" · "}
              {formatDistanceToNowStrict(new Date(ev.created_at), {
                addSuffix: true,
                locale: ptBR,
              })}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm capitalize">{value}</p>
    </div>
  );
}

function ListInfo({ title, values, empty }: { title: string; values: unknown[]; empty: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {values.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
          {values.map((value, index) => (
            <li key={index}>{typeof value === "string" ? value : JSON.stringify(value)}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}
