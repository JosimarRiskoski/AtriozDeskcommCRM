"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useReactivations } from "@/hooks/leads/useReactivations";

type Preview = {
  selected: number;
  eligible: number;
  excluded: number;
  excluded_by_reason: Array<{ reason: string; count: number }>;
  created?: number;
};

function dateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("pt-BR") : "Não informado";
}

export function ReactivationsTab({ canWrite }: { canWrite: boolean }) {
  const query = useReactivations();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const items = query.data ?? [];
  const eligibleLost = useMemo(
    () => items.filter((item) => !item.generated_alert && item.eligible),
    [items],
  );
  const suggestedFlow = eligibleLost.find((item) => item.suggested_flow_id)?.suggested_flow_id;

  async function decide(leadId: string, proposalId: string, decision: "accept" | "dismiss") {
    setBusy(true);
    try {
      const response = await apiClient.post<{ data: { envio_agendado: boolean } }>(
        `/api/v1/leads/${leadId}/reactivation`,
        { proposal_id: proposalId, decision },
      );
      toast.success(
        decision === "dismiss"
          ? "Sugestão encerrada."
          : response.data.envio_agendado
            ? "Retomada autorizada e colocada na fila."
            : "Retomada autorizada; já existia uma ação pendente ou faltou um contato válido.",
      );
      await queryClient.invalidateQueries({ queryKey: ["reactivations"] });
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(false);
    }
  }

  async function runBulk(confirm: boolean) {
    if (!suggestedFlow || selected.length === 0) return;
    setBusy(true);
    try {
      const response = await apiClient.post<{ data: Preview }>(
        "/api/v1/ai/followups/enrollments/bulk",
        { pointer_id: suggestedFlow, lead_ids: selected, confirm },
      );
      setPreview(response.data);
      if (confirm) {
        toast.success(`${response.data.created ?? 0} reativação(ões) iniciada(s).`);
        setSelected([]);
        setPreview(null);
        await queryClient.invalidateQueries({ queryKey: ["reactivations"] });
      }
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(false);
    }
  }

  if (query.isLoading)
    return <p className="text-sm text-muted-foreground">Carregando reativações…</p>;

  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Reativações</h2>
            <p className="text-sm text-muted-foreground">
              Oportunidades perdidas há 30 dias ou alertas automáticos que ainda exigem decisão.
            </p>
          </div>
          {canWrite && eligibleLost.length > 0 ? (
            <Button
              variant="outline"
              onClick={() => {
                setPreview(null);
                setSelected(eligibleLost.map((item) => item.lead_id));
              }}
            >
              Selecionar elegíveis ({eligibleLost.length})
            </Button>
          ) : null}
        </div>
        {selected.length > 0 ? (
          <div className="bg-muted/30 rounded-md border p-3 text-sm">
            <p>
              <b>{selected.length}</b> selecionado(s) · fluxo sugerido:{" "}
              {eligibleLost[0]?.suggested_flow_name ?? "—"}
            </p>
            {preview ? (
              <div className="mt-2">
                <p>
                  <b>{preview.eligible}</b> elegíveis · <b>{preview.excluded}</b> excluídos
                </p>
                {preview.excluded_by_reason.map((reason) => (
                  <p key={reason.reason} className="text-xs text-muted-foreground">
                    {reason.count} · {reason.reason}
                  </p>
                ))}
              </div>
            ) : null}
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSelected([]);
                  setPreview(null);
                }}
              >
                Cancelar
              </Button>
              {!preview ? (
                <Button size="sm" disabled={busy} onClick={() => runBulk(false)}>
                  Validar seleção
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={busy || preview.eligible === 0}
                  onClick={() => runBulk(true)}
                >
                  Iniciar {preview.eligible} reativação(ões)
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </Card>

      {items.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          Nenhuma reativação pendente ou oportunidade perdida há mais de 30 dias.
        </Card>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <Card key={item.lead_id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  {canWrite && !item.generated_alert ? (
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${item.contact_name}`}
                      checked={selected.includes(item.lead_id)}
                      disabled={!item.eligible}
                      onChange={(event) => {
                        setPreview(null);
                        setSelected((current) =>
                          event.target.checked
                            ? [...new Set([...current, item.lead_id])]
                            : current.filter((id) => id !== item.lead_id),
                        );
                      }}
                    />
                  ) : null}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{item.contact_name}</strong>
                      {item.generated_alert ? (
                        <Badge variant="warning">Alerta automático</Badge>
                      ) : (
                        <Badge>Perdido há 30+ dias</Badge>
                      )}
                      {!item.eligible ? <Badge variant="error">Não elegível</Badge> : null}
                    </div>
                    <p className="truncate text-sm">{item.lead_title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.eligibility_reason}</p>
                    <p className="text-xs text-muted-foreground">
                      Última interação: {dateTime(item.last_interaction_at)} · Perdido em:{" "}
                      {dateTime(item.lost_since)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Fluxo sugerido: {item.suggested_flow_name ?? "nenhum fluxo publicado"}
                      {item.excluded_reason ? ` · Motivo: ${item.excluded_reason}` : ""}
                    </p>
                  </div>
                </div>
                {canWrite && item.proposal_id ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => decide(item.lead_id, item.proposal_id!, "dismiss")}
                    >
                      Encerrar
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy || !item.eligible}
                      onClick={() => decide(item.lead_id, item.proposal_id!, "accept")}
                    >
                      Retomar
                    </Button>
                  </div>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
