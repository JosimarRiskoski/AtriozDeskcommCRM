"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { skipWhatsapp, markWhatsappConfigured } from "@/app/actions/onboarding/skipWhatsapp";

interface Props {
  evolutionConfigured: boolean;
  sessionName: string;
}

type Status =
  | "INIT"
  | "STARTING"
  | "SCAN_QR_CODE"
  | "WORKING"
  | "FAILED"
  | "STOPPED"
  | "NOT_STARTED"
  | "ERROR";

interface SessionInfo {
  status: Status;
  session: string | null;
  channel_session_id?: string;
  error?: string;
}

/**
 * Server actions throw a sentinel `NEXT_REDIRECT` when calling `redirect()`.
 * The Next runtime catches it at the boundary, but inside a try/catch we
 * must re-throw so navigation actually happens.
 */
function isRedirectError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "digest" in err &&
      typeof (err as { digest?: unknown }).digest === "string" &&
      (err as { digest: string }).digest.startsWith("NEXT_REDIRECT"),
  );
}

export function ConnectWhatsappClient({ evolutionConfigured, sessionName }: Props) {
  const [pending, startTransition] = useTransition();
  const [info, setInfo] = useState<SessionInfo>({ status: "INIT", session: sessionName });
  const [qrTick, setQrTick] = useState(0);
  const [busy, setBusy] = useState(false);

  const status = info.status;

  // 1) Ao montar, cria/inicia a instância Evolution quando necessário.
  useEffect(() => {
    if (!evolutionConfigured) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const res = await fetch("/api/v1/onboarding/whatsapp/session", { method: "POST" });
        const json = (await res.json()) as { data?: SessionInfo };
        if (!cancelled && json.data) setInfo(json.data);
      } catch (err) {
        if (!cancelled) setInfo({ status: "ERROR", session: sessionName, error: String(err) });
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [evolutionConfigured, sessionName]);

  // 2) Poll status every 3 seconds until WORKING/FAILED.
  useEffect(() => {
    if (!evolutionConfigured) return;
    if (status === "WORKING" || status === "FAILED") return;
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/v1/onboarding/whatsapp/session");
        const json = (await res.json()) as { data?: SessionInfo };
        if (json.data) {
          setInfo(json.data);
          if (json.data.status === "SCAN_QR_CODE") setQrTick((t) => t + 1);
        }
      } catch {
        // ignore transient errors
      }
    }, 3000);
    return () => clearInterval(id);
  }, [evolutionConfigured, status]);

  // 3) When status → WORKING, auto-advance.
  useEffect(() => {
    if (status !== "WORKING") return;
    startTransition(async () => {
      try {
        await markWhatsappConfigured(sessionName, "WORKING");
      } catch (err) {
        if (isRedirectError(err)) throw err;
        toast.error("Falha ao avançar: " + String(err));
      }
    });
  }, [status, sessionName]);

  const showQr = evolutionConfigured && status === "SCAN_QR_CODE";

  return (
    <div className="space-y-4 rounded-lg border bg-background p-6">
      {!evolutionConfigured && (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="font-medium">Evolution API não está configurada.</p>
          <p className="mt-1">
            Configure <code>EVOLUTION_API_BASE_URL</code> e <code>EVOLUTION_API_KEY</code>, depois recarregue, ou pule este passo
            agora — você pode configurar WhatsApp depois em{" "}
            <strong>Configurações → Canais</strong>.
          </p>
        </div>
      )}

      {evolutionConfigured && (
        <div className="rounded-md border bg-muted/40 p-4">
          <p className="text-sm font-medium">
            Sessão: <code>{sessionName}</code>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Status: <code>{busy ? "STARTING…" : status}</code>
          </p>

          {showQr && (
            <div className="mt-4 flex flex-col items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={qrTick}
                src={`/api/v1/onboarding/whatsapp/qr?t=${qrTick}`}
                alt="QR Code para conectar WhatsApp"
                className="h-64 w-64 rounded-md border bg-white p-2"
              />
              <p className="max-w-xs text-center text-xs text-muted-foreground">
                Abra o WhatsApp no celular → Configurações → Aparelhos conectados → Conectar um
                aparelho → escaneie o código acima.
              </p>
            </div>
          )}

          {status === "STARTING" && (
            <p className="mt-3 text-xs text-muted-foreground">
              Aguardando a Evolution gerar o QR Code…
            </p>
          )}

          {status === "WORKING" && (
            <p className="mt-3 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              ✓ Conectado! Avançando…
            </p>
          )}

          {status === "FAILED" && (
            <p className="mt-3 text-sm text-destructive">
              Falha ao conectar. Verifique a instância e os logs da Evolution API.
            </p>
          )}

          {(status === "ERROR" || status === "NOT_STARTED") && (
            <p className="mt-3 text-xs text-muted-foreground">
              {info.error
                ? `Erro: ${info.error}`
                : "Sessão ainda não iniciada — clique em Já configurei pra recarregar."}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              try {
                await skipWhatsapp();
              } catch (err) {
                if (isRedirectError(err)) throw err;
                toast.error("Falha ao pular: " + String(err));
              }
            })
          }
        >
          Pular por enquanto
        </Button>
        <Button
          type="button"
          disabled={pending || status === "WORKING"}
          onClick={() =>
            startTransition(async () => {
              try {
                await markWhatsappConfigured(
                  sessionName,
                  status === "WORKING" ? "WORKING" : "configured",
                );
              } catch (err) {
                if (isRedirectError(err)) throw err;
                toast.error("Falha ao marcar passo: " + String(err));
              }
            })
          }
        >
          Já configurei (continuar)
        </Button>
      </div>
    </div>
  );
}
