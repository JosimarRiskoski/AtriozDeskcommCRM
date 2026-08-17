"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle, CircleNotch, PaperPlaneTilt, Warning } from "@/lib/ui/icons";
import { metaCapiErrorLabel } from "@/lib/meta-capi/errors";

type ConversionEvent = {
  id: string;
  event_name: string;
  conversion_label: string | null;
  status: "pending" | "processing" | "sent" | "failed" | "skipped";
  attempts: number;
  requested_at: string | null;
  sent_at: string | null;
  last_error: string | null;
  requested_by: string | null;
};

type ConversionState = {
  event: ConversionEvent | null;
  eligible: boolean;
  configuration: {
    enabled: boolean;
    event_name: string;
    conversion_label: string;
    test_mode: boolean;
    require_consent: boolean;
  } | null;
  opportunity: {
    id: string;
    title: string;
    status: string;
    value_cents: number | null;
    currency: string | null;
  };
  matching: { phone: boolean; email: boolean; consent: boolean };
};

export function MetaConversionControl({ leadId }: { leadId: string }) {
  const [state, setState] = useState<ConversionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/leads/${leadId}/meta-conversion`, {
        cache: "no-store",
      });
      const json = (await response.json()) as { data?: ConversionState };
      if (response.ok && json.data) setState(json.data);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!state?.event || !["pending", "processing"].includes(state.event.status)) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load, state?.event]);

  async function requestConversion() {
    setSubmitting(true);
    try {
      const response = await fetch(`/api/v1/leads/${leadId}/meta-conversion`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      const json = (await response.json()) as { error?: { message?: string } };
      if (!response.ok)
        throw new Error(json.error?.message || "Nao foi possivel enviar a conversao.");
      toast.success("Conversao confirmada e colocada na fila da Meta.");
      setConfirmOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel enviar a conversao.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <span className="text-xs text-muted-foreground">Verificando Meta...</span>;
  if (!state?.configuration) return null;

  const event = state.event;
  const processing = event?.status === "pending" || event?.status === "processing";
  const sent = event?.status === "sent";
  const retryable = event?.status === "failed" || event?.status === "skipped";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {sent ? (
        <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
          <CheckCircle size={13} /> Conversao enviada{" "}
          {event.sent_at ? new Date(event.sent_at).toLocaleString("pt-BR") : ""}
          {event.requested_by ? ` por ${event.requested_by}` : ""}
        </Badge>
      ) : processing ? (
        <Badge variant="outline" className="gap-1">
          <CircleNotch size={13} className="animate-spin" /> Enviando para a Meta
        </Badge>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          disabled={!state.eligible}
          onClick={() => setConfirmOpen(true)}
          title={
            !state.eligible
              ? "Revise a configuracao, os dados de correspondencia e o consentimento."
              : "Enviar uma unica conversao desta oportunidade"
          }
        >
          <PaperPlaneTilt size={13} className="mr-1" />{" "}
          {retryable ? "Tentar conversao novamente" : "Enviar conversao para Meta"}
        </Button>
      )}
      {retryable && event?.last_error ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
          <Warning size={12} /> {metaCapiErrorLabel(event.last_error)}
        </span>
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enviar conversao para a Meta?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acao envia uma conversao real da oportunidade{" "}
              <strong>{state.opportunity.title}</strong>. Depois do sucesso, nao podera ser enviada
              novamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 rounded-md border p-4 text-sm">
            <div>
              <span className="text-muted-foreground">Marco comercial:</span>{" "}
              {state.configuration.conversion_label}
            </div>
            <div>
              <span className="text-muted-foreground">Evento tecnico:</span>{" "}
              {state.configuration.event_name}
            </div>
            <div>
              <span className="text-muted-foreground">Valor:</span>{" "}
              {state.opportunity.value_cents == null
                ? "Nao informado"
                : new Intl.NumberFormat("pt-BR", {
                    style: "currency",
                    currency: state.opportunity.currency || "BRL",
                  }).format(state.opportunity.value_cents / 100)}
            </div>
            <div>
              <span className="text-muted-foreground">Ambiente:</span>{" "}
              {state.configuration.test_mode ? "Teste da Meta" : "Producao"}
            </div>
            <div>
              <span className="text-muted-foreground">Correspondencia:</span>{" "}
              {[state.matching.phone && "telefone", state.matching.email && "e-mail"]
                .filter(Boolean)
                .join(" e ") || "indisponivel"}
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={(event) => {
                event.preventDefault();
                void requestConversion();
              }}
            >
              {submitting ? "Confirmando..." : "Confirmar envio unico"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
