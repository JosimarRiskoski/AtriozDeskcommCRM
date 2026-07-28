"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useInviteMembers } from "@/hooks/team/useInviteMembers";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLES, type Role } from "@/lib/schemas/team";
import { apiClient } from "@/lib/api/client";

interface ResultState {
  sent: Array<{ email: string; accept_url: string; email_dispatched: boolean; expires_at: string }>;
  failed: Array<{ email: string; reason: string }>;
}

interface InvitationRow {
  id: string;
  email: string;
  role: string;
  display_status: "pending" | "accepted" | "expired" | "cancelled" | "failed";
  expires_at: string;
  email_dispatched: boolean;
  last_error: string | null;
  last_sent_at: string | null;
}

const STATUS_LABEL: Record<InvitationRow["display_status"], string> = {
  pending: "Pendente",
  accepted: "Aceito",
  expired: "Expirado",
  cancelled: "Cancelado",
  failed: "Falhou",
};

const ROLE_LABEL: Record<Role, string> = {
  viewer: "Leitor — somente consulta",
  agent: "Atendente — conversa com clientes",
  manager: "Gerente — acompanha e distribui atendimento",
  admin: "Administrador — configura e gerencia a organização",
};

export function InviteForm() {
  const [emailsRaw, setEmailsRaw] = useState("");
  const [role, setRole] = useState<Role>("agent");
  const [result, setResult] = useState<ResultState | null>(null);
  const [history, setHistory] = useState<InvitationRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const invite = useInviteMembers();

  const loadHistory = useCallback(async () => {
    try {
      const response = await apiClient.get<{ data: InvitationRow[] }>("/api/v1/team/invite");
      setHistory(response.data);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const emails = emailsRaw
      .split(/[\n,;]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const unique = Array.from(new Set(emails));
    if (unique.length === 0) {
      toast.error("Adicione ao menos um email.");
      return;
    }
    if (unique.length > 20) {
      toast.error("Máximo 20 emails por convite.");
      return;
    }
    try {
      const res = await invite.mutateAsync({
        invitations: unique.map((email) => ({ email, role })),
      });
      setResult(res.data);
      const ok = res.data.sent.length;
      const ko = res.data.failed.length;
      toast.success(`${ok} convite(s) enviado(s)${ko > 0 ? `, ${ko} falha(s).` : "."}`);
      setEmailsRaw("");
      await loadHistory();
    } catch {
      /* showApiError handled */
    }
  };

  const act = async (inviteId: string, action: "resend" | "cancel") => {
    setActingId(inviteId);
    try {
      await apiClient.patch("/api/v1/team/invite", { invite_id: inviteId, action });
      toast.success(action === "resend" ? "Convite reenviado." : "Convite cancelado.");
      await loadHistory();
    } catch {
      // apiClient já apresenta a falha de forma padronizada.
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="space-y-8">
    <div className="grid gap-6 md:grid-cols-[1fr,2fr]">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="emails">Emails</Label>
          <Textarea
            id="emails"
            value={emailsRaw}
            onChange={(e) => setEmailsRaw(e.target.value)}
            rows={8}
            placeholder={"alice@empresa.com\nbob@empresa.com"}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="role">Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger id="role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={invite.isPending}>
          {invite.isPending ? "Enviando…" : "Enviar convites"}
        </Button>
      </form>

      <div className="space-y-4">
        {result ? (
          <>
            {result.sent.length > 0 ? (
              <section>
                <h2 className="text-sm font-semibold">Enviados ({result.sent.length})</h2>
                <ul className="mt-2 space-y-2 text-sm">
                  {result.sent.map((s) => (
                    <li key={s.email} className="rounded-md border p-2">
                      <div className="font-medium">{s.email}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.email_dispatched
                          ? "Email enviado."
                          : "Resend não configurado — link copiável abaixo (DEV)."}
                      </div>
                      {!s.email_dispatched ? (
                        <code className="mt-1 block break-all text-xs">{s.accept_url}</code>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {result.failed.length > 0 ? (
              <section>
                <h2 className="text-sm font-semibold text-destructive">
                  Falhas ({result.failed.length})
                </h2>
                <ul className="mt-2 space-y-1 text-sm">
                  {result.failed.map((f) => (
                    <li key={f.email}>
                      <span className="font-medium">{f.email}</span>{" "}
                      <span className="text-muted-foreground">— {f.reason}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Resultados aparecerão aqui após o envio.
          </p>
        )}
      </div>
    </div>
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Histórico de convites</h2>
          <p className="text-sm text-muted-foreground">Acompanhe pendências, falhas, expiração e aceite.</p>
        </div>
        {historyLoading ? (
          <p className="text-sm text-muted-foreground">Carregando convites…</p>
        ) : history.length === 0 ? (
          <p className="rounded-md border p-4 text-sm text-muted-foreground">Nenhum convite registrado.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr><th className="p-3">E-mail</th><th className="p-3">Permissão</th><th className="p-3">Status</th><th className="p-3">Validade</th><th className="p-3 text-right">Ações</th></tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="p-3"><div className="font-medium">{item.email}</div>{item.last_error ? <div className="mt-1 max-w-md text-xs text-destructive">{item.last_error}</div> : null}</td>
                    <td className="p-3">{ROLE_LABEL[item.role as Role] ?? item.role}</td>
                    <td className="p-3">{STATUS_LABEL[item.display_status]}</td>
                    <td className="p-3">{new Date(item.expires_at).toLocaleString("pt-BR")}</td>
                    <td className="p-3"><div className="flex justify-end gap-2">
                      {item.display_status !== "accepted" && item.display_status !== "cancelled" ? <Button type="button" size="sm" variant="outline" disabled={actingId === item.id} onClick={() => void act(item.id, "resend")}>Reenviar</Button> : null}
                      {item.display_status === "pending" || item.display_status === "expired" || item.display_status === "failed" ? <Button type="button" size="sm" variant="ghost" disabled={actingId === item.id} onClick={() => void act(item.id, "cancel")}>Cancelar</Button> : null}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
