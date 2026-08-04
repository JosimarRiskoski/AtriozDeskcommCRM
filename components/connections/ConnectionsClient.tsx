"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { useChannelSessions, type ChannelSession } from "@/hooks/channels/useChannelSessions";
import { usePacingKnobs } from "@/hooks/channels/usePacingKnobs";
import { AntiBanSheet } from "./AntiBanSheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ArrowsClockwise,
  CheckCircle,
  CircleNotch,
  Phone,
  Plus,
  ShieldCheck,
  Trash,
  PencilSimple,
  Archive,
} from "@/lib/ui/icons";

type Variant = "success" | "warning" | "error" | "neutral";

const STATUS_MAP: Record<string, { label: string; variant: Variant }> = {
  WORKING: { label: "Conectado", variant: "success" },
  SCAN_QR_CODE: { label: "Escaneie o QR", variant: "warning" },
  STARTING: { label: "Conectando…", variant: "warning" },
  STOPPED: { label: "Parado", variant: "error" },
  FAILED: { label: "Caiu", variant: "error" },
};

function statusInfo(status: string): { label: string; variant: Variant } {
  return STATUS_MAP[status] ?? { label: status, variant: "neutral" };
}

function channelLabel(c: ChannelSession): string {
  return c.display_name || c.phone_number || c.waha_session_name;
}

function errMsg(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

export function ConnectionsClient({ wahaConfigured }: { wahaConfigured: boolean }) {
  const qc = useQueryClient();
  const { data: sessions, isLoading } = useChannelSessions({ refetchInterval: 10_000 });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [qr, setQr] = useState<{ sessionId: string; title: string } | null>(null);
  const [antiBanId, setAntiBanId] = useState<string | null>(null);
  const [newConnectionOpen, setNewConnectionOpen] = useState(false);
  const [manageConnection, setManageConnection] = useState<ChannelSession | null>(null);
  const pacingItems = usePacingKnobs().data?.items ?? [];

  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: ["channel-sessions"] }),
    [qc],
  );

  // Health check ao vivo de todos os canais — consulta o WAHA e grava
  // last_health_check_at. É a verificação de saúde de verdade (o status do DB
  // pode estar velho se o WAHA caiu sem emitir evento).
  const runHealthCheck = useCallback(
    async (list: ChannelSession[]) => {
      if (!wahaConfigured || list.length === 0) return;
      setChecking(true);
      try {
        await Promise.allSettled(
          list.map((c) => apiClient.get(`/api/v1/channel-sessions/${c.id}`)),
        );
        invalidate();
      } finally {
        setChecking(false);
      }
    },
    [wahaConfigured, invalidate],
  );

  const didInitialCheck = useRef(false);
  useEffect(() => {
    if (didInitialCheck.current || !sessions || sessions.length === 0) return;
    didInitialCheck.current = true;
    void runHealthCheck(sessions);
  }, [sessions, runHealthCheck]);

  const handleConnectNew = useCallback(
    async (input: { display_name: string; purpose?: string; is_default: boolean }) => {
      setCreating(true);
      try {
        const res = await apiClient.post<{ data: ChannelSession }>(
          "/api/v1/channel-sessions",
          input,
        );
        invalidate();
        setNewConnectionOpen(false);
        setQr({ sessionId: res.data.id, title: "Conectar novo WhatsApp" });
      } catch (err) {
        toast.error(errMsg(err, "Não foi possível iniciar a conexão."));
      } finally {
        setCreating(false);
      }
    },
    [invalidate],
  );

  const handleReconnect = useCallback(
    async (c: ChannelSession) => {
      setBusyId(c.id);
      try {
        await apiClient.post(`/api/v1/channel-sessions/${c.id}/reconnect`, {});
        invalidate();
        setQr({ sessionId: c.id, title: `Reconectar ${channelLabel(c)}` });
      } catch (err) {
        toast.error(errMsg(err, "Não foi possível reconectar."));
      } finally {
        setBusyId(null);
      }
    },
    [invalidate],
  );

  const handleConnected = useCallback(() => {
    toast.success("WhatsApp conectado!");
    setQr(null);
    invalidate();
  }, [invalidate]);

  const list = sessions ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card className="grid gap-3 p-4 md:grid-cols-3">
        <div>
          <p className="text-sm font-semibold">1. Conexão</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Confirma se o número está realmente conectado ao WhatsApp.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold">2. Atendimento</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Com a conexão ativa, Inbox, atendimento humano e IA podem receber e enviar mensagens.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold">3. Proteção de envio</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Define horário, intervalo e limite diário para reduzir bloqueios. Não pausa o WhatsApp.
          </p>
        </div>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {list.length === 0
            ? "Nenhum número conectado ainda."
            : `${list.length} ${list.length === 1 ? "número conectado" : "números conectados"}.`}
        </p>
        <div className="flex gap-2">
          {list.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              disabled={checking || !wahaConfigured}
              onClick={() => void runHealthCheck(list)}
            >
              <ArrowsClockwise
                size={14}
                className={checking ? "animate-spin" : undefined}
                aria-hidden
              />
              Atualizar saúde
            </Button>
          )}
          <Button
            size="sm"
            disabled={creating || !wahaConfigured}
            onClick={() => setNewConnectionOpen(true)}
          >
            {creating ? (
              <CircleNotch size={14} className="animate-spin" aria-hidden />
            ) : (
              <Plus size={14} aria-hidden />
            )}
            Conectar novo WhatsApp
          </Button>
        </div>
      </div>

      {!wahaConfigured && (
        <div className="rounded-md border border-warning bg-warning-bg p-4 text-sm text-warning-fg">
          <p className="font-medium">O serviço do WhatsApp não está ativo.</p>
          <p className="mt-1">
            Suba o container (<code>docker compose up -d waha</code>) para conectar e reconectar
            números.
          </p>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando conexões…</p>
      ) : list.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <Phone size={28} className="text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            Conecte seu primeiro número de WhatsApp para começar a atender.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {list.map((c) => {
            const info = statusInfo(c.status);
            const ready = c.status === "WORKING";
            const pacing = pacingItems.find((item) => item.channel_session.id === c.id);
            return (
              <Card key={c.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Phone size={16} className="text-muted-foreground" aria-hidden />
                      <span className="truncate text-sm font-medium">{channelLabel(c)}</span>
                    </div>
                    {c.phone_number && c.display_name && (
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {c.phone_number}
                      </p>
                    )}
                  </div>
                  <Badge variant={info.variant}>{info.label}</Badge>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {c.is_default ? (
                    <Badge variant="secondary">Padrão para novos envios</Badge>
                  ) : null}
                  {c.purpose ? <Badge variant="outline">{c.purpose}</Badge> : null}
                  {c.phone_number ? (
                    <Badge variant="outline">Final {c.phone_number.replace(/\D/g, "").slice(-4)}</Badge>
                  ) : null}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {c.last_health_check_at
                    ? `Verificado ${new Date(c.last_health_check_at).toLocaleString("pt-BR")}`
                    : "Ainda não verificado"}
                </p>
                <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
                  <span className="text-muted-foreground">Última recebida</span>
                  <span className="text-right">
                    {c.last_inbound_at
                      ? new Date(c.last_inbound_at).toLocaleString("pt-BR")
                      : "Nenhuma registrada"}
                  </span>
                  <span className="text-muted-foreground">Última enviada</span>
                  <span className="text-right">
                    {c.last_outbound_at
                      ? new Date(c.last_outbound_at).toLocaleString("pt-BR")
                      : "Nenhuma registrada"}
                  </span>
                </div>
                {c.status_reason ? (
                  <p className="rounded-md bg-error-bg px-2.5 py-2 text-xs text-error-fg">
                    Motivo informado: {c.status_reason}
                  </p>
                ) : null}
                <div className="bg-muted/30 grid grid-cols-2 gap-2 rounded-md border p-2.5 text-xs">
                  <span className="text-muted-foreground">Inbox e humano</span>
                  <span className={ready ? "text-success-fg" : "text-warning-fg"}>
                    {ready ? "Pronto" : "Aguardando conexão"}
                  </span>
                  <span className="text-muted-foreground">IA e follow-ups</span>
                  <span className={ready ? "text-success-fg" : "text-warning-fg"}>
                    {ready ? "Canal disponível" : "Indisponível"}
                  </span>
                  <span className="text-muted-foreground">Limite diário</span>
                  <span>
                    {pacing?.channel_session.daily_message_limit ?? c.daily_message_limit} mensagens
                  </span>
                </div>
                <div className="mt-auto flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === c.id || !wahaConfigured}
                    onClick={() => handleReconnect(c)}
                  >
                    {busyId === c.id ? (
                      <CircleNotch size={14} className="animate-spin" aria-hidden />
                    ) : (
                      <ArrowsClockwise size={14} aria-hidden />
                    )}
                    Reconectar
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setAntiBanId(c.id)}>
                    <ShieldCheck size={14} aria-hidden />
                    Proteção de envio
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setManageConnection(c)}>
                    <PencilSimple size={14} aria-hidden />
                    Gerenciar
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <AntiBanSheet
        item={pacingItems.find((i) => i.channel_session.id === antiBanId) ?? null}
        canWrite
        onClose={() => setAntiBanId(null)}
      />

      <NewConnectionDialog
        open={newConnectionOpen}
        onOpenChange={setNewConnectionOpen}
        pending={creating}
        hasConnections={list.length > 0}
        onCreate={handleConnectNew}
      />

      <ManageConnectionDialog
        connection={manageConnection}
        onOpenChange={(open) => !open && setManageConnection(null)}
        onChanged={() => {
          setManageConnection(null);
          invalidate();
        }}
      />

      {qr && (
        <QrDialog
          sessionId={qr.sessionId}
          title={qr.title}
          wahaConfigured={wahaConfigured}
          onClose={() => setQr(null)}
          onConnected={handleConnected}
        />
      )}
    </div>
  );
}

function NewConnectionDialog({
  open,
  onOpenChange,
  pending,
  hasConnections,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  hasConnections: boolean;
  onCreate: (input: { display_name: string; purpose?: string; is_default: boolean }) => void;
}) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [isDefault, setIsDefault] = useState(!hasConnections);
  useEffect(() => {
    if (open) setIsDefault(!hasConnections);
  }, [open, hasConnections]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Conectar novo WhatsApp</DialogTitle>
          <DialogDescription>
            Dê um nome fácil de reconhecer. O número aparecerá após a leitura do QR Code.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-connection-name">Nome da conexão</Label>
            <Input
              id="new-connection-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Comercial principal"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-connection-purpose">Finalidade</Label>
            <Input
              id="new-connection-purpose"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              placeholder="Ex.: Atendimento e fechamento"
            />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <span>
              <span className="block font-medium">Conexão padrão</span>
              <span className="text-xs text-muted-foreground">
                Usada como primeira opção em novos envios.
              </span>
            </span>
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              disabled={pending || name.trim().length < 2}
              onClick={() =>
                onCreate({
                  display_name: name.trim(),
                  purpose: purpose.trim() || undefined,
                  is_default: isDefault,
                })
              }
            >
              {pending ? "Preparando…" : "Gerar QR Code"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type ConnectionDependencies = Record<string, number>;

function ManageConnectionDialog({
  connection,
  onOpenChange,
  onChanged,
}: {
  connection: ChannelSession | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [dependencies, setDependencies] = useState<ConnectionDependencies | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!connection) return;
    setName(connection.display_name || "");
    setPurpose(connection.purpose || "");
    setIsDefault(connection.is_default);
    setReason("");
    setConfirmation("");
    setDependencies(null);
    void apiClient
      .get<{ data: { dependencies: ConnectionDependencies } }>(
        `/api/v1/channel-sessions/${connection.id}?dependencies=1`,
      )
      .then((response) => setDependencies(response.data.dependencies))
      .catch(() => toast.error("Não foi possível verificar os vínculos desta conexão."));
  }, [connection]);

  if (!connection) return null;
  const totalDependencies = Object.values(dependencies ?? {}).reduce(
    (sum, count) => sum + count,
    0,
  );
  const inactive = ["FAILED", "STOPPED"].includes(connection.status);

  async function mutate(action: "save" | "archive" | "delete") {
    setPending(true);
    try {
      if (action === "save") {
        await apiClient.patch(`/api/v1/channel-sessions/${connection!.id}`, {
          action: "update",
          display_name: name.trim(),
          purpose: purpose.trim() || null,
          is_default: isDefault,
        });
        toast.success("Conexão atualizada.");
      } else if (action === "archive") {
        await apiClient.patch(`/api/v1/channel-sessions/${connection!.id}`, {
          action: "archive",
          reason: reason.trim(),
        });
        toast.success("Conexão arquivada. O histórico foi preservado.");
      } else {
        await apiClient.delete(`/api/v1/channel-sessions/${connection!.id}`, {
          headers: {
            "X-Confirm-Connection-Name": encodeURIComponent(confirmation),
            "X-Deletion-Reason": encodeURIComponent(reason.trim()),
          },
        });
        toast.success("Sessão técnica excluída.");
      }
      onChanged();
    } catch (error) {
      toast.error(errMsg(error, "Não foi possível concluir a operação."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gerenciar conexão</DialogTitle>
          <DialogDescription>
            {connection.phone_number || connection.waha_session_name}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-3 rounded-md border p-3">
            <div className="space-y-2">
              <Label htmlFor="manage-name">Nome</Label>
              <Input
                id="manage-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manage-purpose">Finalidade</Label>
              <Input
                id="manage-purpose"
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
              />
            </div>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Usar como conexão padrão</span>
              <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            </label>
            <Button
              disabled={pending || name.trim().length < 2}
              onClick={() => void mutate("save")}
            >
              Salvar identificação
            </Button>
          </div>

          <div className="space-y-2 rounded-md border p-3 text-sm">
            <p className="font-medium">Vínculos encontrados</p>
            {dependencies ? (
              Object.entries(dependencies).map(([label, count]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-muted-foreground">{label.replaceAll("_", " ")}</span>
                  <span>{count}</span>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">Verificando…</p>
            )}
          </div>

          <div className="space-y-3 rounded-md border border-warning p-3">
            <div className="space-y-2">
              <Label htmlFor="connection-reason">Motivo</Label>
              <Textarea
                id="connection-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Explique por que esta conexão será removida"
              />
            </div>
            {!inactive ? (
              <p className="text-xs text-warning-fg">
                Desconecte o WhatsApp antes de arquivar ou excluir.
              </p>
            ) : null}
            {connection.is_default ? (
              <p className="text-xs text-warning-fg">
                Defina outra conexão como padrão antes de remover esta.
              </p>
            ) : null}
            <Button
              variant="outline"
              disabled={pending || !inactive || connection.is_default || reason.trim().length < 3}
              onClick={() => void mutate("archive")}
            >
              <Archive size={14} /> Arquivar e preservar histórico
            </Button>
            <div className="space-y-2 border-t pt-3">
              <Label htmlFor="delete-confirmation">
                Para excluir a sessão técnica, digite: {connection.display_name}
              </Label>
              <Input
                id="delete-confirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
              <Button
                variant="destructive"
                disabled={
                  pending ||
                  !inactive ||
                  connection.is_default ||
                  totalDependencies > 0 ||
                  confirmation !== connection.display_name ||
                  reason.trim().length < 3
                }
                onClick={() => void mutate("delete")}
              >
                <Trash size={14} /> Excluir sessão técnica
              </Button>
              {totalDependencies > 0 ? (
                <p className="text-xs text-muted-foreground">
                  A exclusão técnica está bloqueada porque existem vínculos. Use Arquivar ou
                  reatribua as configurações.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function QrDialog({
  sessionId,
  title,
  wahaConfigured,
  onClose,
  onConnected,
}: {
  sessionId: string;
  title: string;
  wahaConfigured: boolean;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [status, setStatus] = useState<string>("STARTING");
  const [tick, setTick] = useState(0);
  const done = useRef(false);
  const qrShown = useRef(false);

  useEffect(() => {
    if (!wahaConfigured) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await apiClient.get<{ data: { status: string } }>(
          `/api/v1/channel-sessions/${sessionId}`,
        );
        if (cancelled) return;
        const s = res.data.status;
        setStatus(s);
        // NOWEB: o QR é estável até conectar — carrega a imagem UMA vez ao entrar
        // em SCAN_QR_CODE (evita o flash branco de recarregar a cada poll).
        if (s === "SCAN_QR_CODE" && !qrShown.current) {
          qrShown.current = true;
          setTick((t) => t + 1);
        }
        if (s === "WORKING" && !done.current) {
          done.current = true;
          onConnected();
        }
      } catch {
        // erro transitório de rede — o próximo tick tenta de novo
      }
    };
    void poll();
    const iv = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [sessionId, wahaConfigured, onConnected]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho → escaneie o código.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 py-2">
          {status === "SCAN_QR_CODE" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={tick}
              src={`/api/v1/channel-sessions/${sessionId}/qr?t=${tick}`}
              alt="QR Code para conectar WhatsApp"
              className="h-64 w-64 rounded-md border bg-white p-2"
            />
          ) : status === "WORKING" ? (
            <div className="flex flex-col items-center gap-2 text-sm font-medium text-success-fg">
              <CheckCircle size={28} weight="fill" aria-hidden />
              Conectado!
            </div>
          ) : status === "FAILED" || status === "STOPPED" ? (
            <p className="text-center text-sm text-error-fg">
              Não foi possível conectar. Feche e tente “Reconectar”.
            </p>
          ) : (
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <CircleNotch size={28} className="animate-spin" aria-hidden />
              Preparando o código…
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
