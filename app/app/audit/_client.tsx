"use client";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuditQuery, type AuditFilters } from "@/hooks/audit/useAuditQuery";

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", { hour12: false });
  } catch {
    return iso;
  }
}

const ACTION_LABELS: Record<string, string> = {
  "ai.contact_control_changed": "Controle da IA alterado para um contato",
  "ai.paused_by_agent": "IA pausada pela equipe",
  "ai.reactivated_by_agent": "Contato devolvido para a IA",
  "ai.handoff_triggered": "IA pediu atendimento humano",
  "contact.created": "Contato criado",
  "contact.updated": "Dados do contato atualizados",
  "contact.blocked": "Contato bloqueado",
  "conversation.claimed": "Conversa assumida por um atendente",
  "conversation.closed": "Conversa encerrada",
  "conversation.transferred": "Conversa transferida",
  "conversation.note_added": "Observação adicionada à conversa",
  "lead.created": "Negócio criado",
  "lead.moved": "Negócio movido de etapa",
  "lead.updated": "Negócio atualizado",
  "lead.won": "Negócio marcado como ganho",
  "lead.lost": "Negócio marcado como perdido",
  "message.received": "Mensagem recebida",
  "message.sent": "Mensagem enviada",
  "member.invited": "Pessoa convidada para a equipe",
  "member.accepted": "Convite da equipe aceito",
  "member.revoked": "Acesso de uma pessoa removido",
  "campaign.created": "Campanha criada",
  "followup_enrollment.created": "Follow-up iniciado para um contato",
  "followup_enrollment.cancelled": "Follow-up cancelado",
  "notification_prefs.changed": "Preferências de notificação alteradas",
  "pipeline.created": "Funil criado",
  "pipeline.renamed": "Funil renomeado",
  "pipeline.duplicated": "Funil duplicado",
  "pipeline.stage_archived": "Etapa do funil arquivada",
  "template.created": "Resposta rápida criada",
  "template.updated": "Resposta rápida atualizada",
  "template.deleted": "Resposta rápida removida",
  "webhook.lead_received": "Lead recebido por integração",
};

const RESOURCE_LABELS: Record<string, string> = {
  contact: "Contato",
  conversation: "Conversa",
  lead: "Negócio",
  campaign: "Campanha",
  pipeline: "Funil",
  message_template: "Resposta rápida",
  organization: "Organização",
  member: "Pessoa da equipe",
};

function actionLabel(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  return action
    .replace(/[._-]+/g, " ")
    .replace(/\b(created|criado)\b/gi, "criado")
    .replace(/\b(updated|atualizado)\b/gi, "atualizado")
    .replace(/\b(deleted|removido)\b/gi, "removido")
    .replace(/^./, (letter) => letter.toLocaleUpperCase("pt-BR"));
}

function actorLabel(row: {
  acting_as_platform_admin: boolean;
  actor_user_id: string | null;
  actor_api_token_id: string | null;
}): string {
  if (row.acting_as_platform_admin) return "Administrador da plataforma";
  if (row.actor_user_id) return "Pessoa da equipe";
  if (row.actor_api_token_id) return "Integração autorizada";
  return "Sistema automático";
}

function resourceLabel(type: string | null): string {
  if (!type) return "Item do sistema";
  return RESOURCE_LABELS[type] ?? type.replace(/[._-]+/g, " ");
}

export function AuditClient() {
  const [actionInput, setActionInput] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filters = useMemo<AuditFilters>(
    () => ({
      action: actionInput || undefined,
      resource_type: resourceType || undefined,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(to).toISOString() : undefined,
    }),
    [actionInput, resourceType, from, to],
  );

  const q = useAuditQuery(filters);
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);

  function handleExport() {
    const qs = new URLSearchParams();
    if (filters.action) qs.set("action", filters.action);
    if (filters.resource_type) qs.set("resource_type", filters.resource_type);
    if (filters.from) qs.set("from", filters.from);
    if (filters.to) qs.set("to", filters.to);
    window.location.href = `/api/v1/audit/export?${qs.toString()}`;
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Acontecimento contém</label>
            <Input
              value={actionInput}
              onChange={(e) => setActionInput(e.target.value)}
              placeholder="ex: contato, campanha, IA"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Tipo de item</label>
            <Input
              value={resourceType}
              onChange={(e) => setResourceType(e.target.value)}
              placeholder="ex: contact ou conversation"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">De</label>
            <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Até</label>
            <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button variant="outline" className="w-full" onClick={handleExport}>
              Exportar CSV
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quando</TableHead>
              <TableHead>Ator</TableHead>
              <TableHead>O que aconteceu</TableHead>
              <TableHead>Item afetado</TableHead>
              <TableHead>Detalhes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                  Nenhum log no período.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {fmtDate(r.created_at)}
                  </TableCell>
                  <TableCell className="text-xs">{actorLabel(r)}</TableCell>
                  <TableCell className="text-sm font-medium">{actionLabel(r.action)}</TableCell>
                  <TableCell className="text-xs">
                    {resourceLabel(r.resource_type)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <details>
                      <summary className="cursor-pointer select-none hover:text-foreground">
                        Ver detalhes técnicos
                      </summary>
                      <div className="mt-2 max-w-md space-y-1 rounded-md bg-muted p-2 font-mono text-[10px] break-all">
                        <p>Ação: {r.action}</p>
                        {r.resource_id ? <p>ID do item: {r.resource_id}</p> : null}
                        {r.request_id ? <p>ID de rastreamento: {r.request_id}</p> : null}
                        {r.metadata ? <pre className="whitespace-pre-wrap">{JSON.stringify(r.metadata, null, 2)}</pre> : null}
                      </div>
                    </details>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {q.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => q.fetchNextPage()}
            disabled={q.isFetchingNextPage}
          >
            {q.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
          </Button>
        </div>
      )}
    </div>
  );
}
