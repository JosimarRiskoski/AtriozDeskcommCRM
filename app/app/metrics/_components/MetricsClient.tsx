"use client";
import { useState } from "react";

import { useAttendantMetrics, type AttendantMetric } from "@/hooks/metrics/useAttendantMetrics";
import { useTeamMembers } from "@/hooks/team/useTeamMembers";
import { usePipelineMetrics } from "@/hooks/metrics/usePipelineMetrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FailuresPanel } from "./FailuresPanel";
import { HumanAiComparison } from "./HumanAiComparison";

const ALL = "__all__";

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest === 0 ? `${m}min` : `${m}min ${rest}s`;
}

function attendantLabel(a: AttendantMetric): string {
  return a.name ?? a.email ?? `Atendente ${a.user_id.slice(0, 8)}`;
}

interface Props {
  canCompare: boolean;
  canConfigureCost: boolean;
  currentUserId: string;
}

export function MetricsClient({ canCompare, canConfigureCost, currentUserId }: Props) {
  const [owner, setOwner] = useState<string>(ALL);
  const [days, setDays] = useState("30");
  const [showFailures, setShowFailures] = useState(false);
  const selectedOwner = owner === ALL ? null : owner;
  const { data, isLoading, isError } = useAttendantMetrics(selectedOwner, Number(days));
  // Opções do filtro: só manager+ (a rota /team é manager+). Agent nem vê o filtro.
  const team = useTeamMembers({ enabled: canCompare });
  const pipelineMetrics = usePipelineMetrics(Number(days), canCompare);

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (isError || !data)
    return <p className="text-sm text-destructive">Erro ao carregar métricas.</p>;

  const metrics = data.data;
  const funnelTotal = metrics.funnel.reduce((acc, s) => acc + s.count, 0);
  const maxCount = Math.max(1, ...metrics.funnel.map((s) => s.count));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Período</span>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {canCompare ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Atendente</span>
            <Select value={owner} onValueChange={setOwner}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Todos os atendentes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os atendentes</SelectItem>
                {(team.data?.data ?? [])
                  .filter((m) => m.role !== "viewer")
                  .map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.full_name ?? m.email ?? m.user_id.slice(0, 8)}
                      {m.user_id === currentUserId ? " (você)" : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Recebidas", metrics.messages.received, "Mensagens que chegaram ao CRM pelo provedor."],
          [
            "Saídas registradas",
            metrics.messages.outbound_recorded,
            "Mensagens criadas no CRM; ainda não prova entrega.",
          ],
          [
            "Entregues",
            metrics.messages.outbound_delivered,
            "Confirmação de entrega ou leitura recebida do provedor.",
          ],
          ["Lidas", metrics.messages.outbound_read, "Confirmação de leitura recebida do WhatsApp."],
          [
            "Falharam",
            metrics.messages.outbound_failed,
            "Envios que terminaram com falha registrada.",
          ],
        ].map(([label, value, description]) => (
          <Card
            key={String(label)}
            className={
              label === "Falharam"
                ? "cursor-pointer transition-colors hover:border-destructive"
                : undefined
            }
            role={label === "Falharam" ? "button" : undefined}
            tabIndex={label === "Falharam" ? 0 : undefined}
            onClick={label === "Falharam" ? () => setShowFailures(true) : undefined}
            onKeyDown={
              label === "Falharam"
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") setShowFailures(true);
                  }
                : undefined
            }
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">{value}</p>
              <p className="mt-2 text-xs text-muted-foreground">{description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <FailuresPanel
        open={showFailures}
        days={Number(days)}
        onClose={() => setShowFailures(false)}
      />
      {canCompare && <HumanAiComparison days={Number(days)} canConfigureCost={canConfigureCost} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Funil {selectedOwner ? "do atendente" : ""} · {funnelTotal}{" "}
            {funnelTotal === 1 ? "aberto" : "abertos"}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Fotografia dos negócios abertos agora; não é limitada pelo período selecionado.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {metrics.funnel.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma etapa configurada.</p>
          ) : (
            metrics.funnel.map((s) => (
              <div key={s.stage_id} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate text-sm">{s.stage_name}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${(s.count / maxCount) * 100}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-sm tabular-nums">{s.count}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {canCompare && pipelineMetrics.data ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Evolução das oportunidades</CardTitle>
            <p className="text-xs text-muted-foreground">
              Movimentações e tempo médio por etapa no período, além do valor aberto atual.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Etapa</TableHead>
                  <TableHead className="text-right">Abertos</TableHead>
                  <TableHead className="text-right">Entradas</TableHead>
                  <TableHead className="text-right">Tempo médio</TableHead>
                  <TableHead className="text-right">Valor aberto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pipelineMetrics.data.stages.map((stage) => (
                  <TableRow key={stage.stage_id}>
                    <TableCell>{stage.stage_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{stage.open_count}</TableCell>
                    <TableCell className="text-right tabular-nums">{stage.entries}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatDuration(stage.avg_seconds)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(stage.value_cents / 100).toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border p-3 text-sm">
                <span className="text-muted-foreground">Ganhos no período</span>
                <p className="text-lg font-semibold tabular-nums">
                  {pipelineMetrics.data.outcomes.won}
                </p>
              </div>
              <div className="rounded-md border p-3 text-sm">
                <span className="text-muted-foreground">Perdidos no período</span>
                <p className="text-lg font-semibold tabular-nums">
                  {pipelineMetrics.data.outcomes.lost}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {canCompare ? "Performance por atendente" : "Sua performance"}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Ganhos e perdidos usam a data de fechamento. Conversas usam a atribuição. A primeira
            resposta mede somente resposta humana após a primeira mensagem recebida; respostas da IA
            não entram nessa média.
          </p>
        </CardHeader>
        <CardContent>
          {metrics.attendants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sem atividade no período (ganhos/perdidos, conversas ou respostas).
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Atendente</TableHead>
                  <TableHead className="text-right">Ganhos</TableHead>
                  <TableHead className="text-right">Perdidos</TableHead>
                  <TableHead className="text-right">Conversas</TableHead>
                  <TableHead className="text-right">1ª resposta (média)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.attendants.map((a) => (
                  <TableRow key={a.user_id}>
                    <TableCell className="font-medium">
                      {attendantLabel(a)}
                      {a.user_id === currentUserId ? (
                        <span className="text-muted-foreground"> (você)</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{a.won}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.lost}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.conversations_handled}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatDuration(a.avg_first_response_seconds)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
