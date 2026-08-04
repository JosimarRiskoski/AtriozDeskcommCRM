"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useTeamMembers, type TeamMember } from "@/hooks/team/useTeamMembers";
import { useChangeRole } from "@/hooks/team/useChangeRole";
import { useRevokeMember } from "@/hooks/team/useRevokeMember";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ROLES, type Role } from "@/lib/schemas/team";
import { DotsThree } from "@/lib/ui/icons";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api/client";

interface Props {
  currentUserId: string;
  canManage: boolean;
}

export function TeamMembersClient({ currentUserId, canManage }: Props) {
  const { data, isLoading, isError } = useTeamMembers();
  const changeRole = useChangeRole();
  const revoke = useRevokeMember();
  const queryClient = useQueryClient();
  const [updatingCasesFor, setUpdatingCasesFor] = useState<string | null>(null);

  const [revokeDialog, setRevokeDialog] = useState<TeamMember | null>(null);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }
  if (isError) {
    return <p className="text-sm text-destructive">Erro ao carregar membros.</p>;
  }
  const members = data?.data ?? [];
  if (members.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum membro ativo.</p>;
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Membro</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Casos humanos</TableHead>
              <TableHead>Última atividade</TableHead>
              {canManage ? <TableHead className="w-[80px]" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.user_id}>
                <TableCell>
                  <div className="font-medium">{m.full_name ?? m.email ?? m.user_id.slice(0, 8)}</div>
                  {m.email ? (
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                  ) : null}
                </TableCell>
                <TableCell>
                  <div className="flex min-w-[190px] flex-col gap-2">
                    <label className="flex items-center gap-2 text-xs">
                      <Switch
                        checked={m.can_receive_human_cases}
                        disabled={!canManage || updatingCasesFor === m.user_id}
                        onCheckedChange={async (checked) => {
                          setUpdatingCasesFor(m.user_id);
                          try {
                            await apiClient.patch(`/api/v1/team/${m.user_id}/human-cases`, {
                              can_receive_human_cases: checked,
                              is_primary_human_case_responder: checked && m.is_primary_human_case_responder,
                            });
                            await queryClient.invalidateQueries({ queryKey: ["team", "members"] });
                            toast.success(checked ? "Membro habilitado para casos." : "Membro removido da fila de casos.");
                          } finally { setUpdatingCasesFor(null); }
                        }}
                      />
                      Pode receber casos
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <Switch
                        checked={m.is_primary_human_case_responder}
                        disabled={!canManage || !m.can_receive_human_cases || updatingCasesFor === m.user_id}
                        onCheckedChange={async (checked) => {
                          setUpdatingCasesFor(m.user_id);
                          try {
                            await apiClient.patch(`/api/v1/team/${m.user_id}/human-cases`, {
                              can_receive_human_cases: true,
                              is_primary_human_case_responder: checked,
                            });
                            await queryClient.invalidateQueries({ queryKey: ["team", "members"] });
                            toast.success(checked ? "Responsável principal definido." : "Responsável principal removido.");
                          } finally { setUpdatingCasesFor(null); }
                        }}
                      />
                      Responsável principal
                    </label>
                  </div>
                </TableCell>
                <TableCell>
                  {canManage && m.user_id !== currentUserId ? (
                    <Select
                      value={m.role}
                      onValueChange={(v) =>
                        changeRole.mutate({ userId: m.user_id, role: v as Role })
                      }
                    >
                      <SelectTrigger
                        className="w-[130px]"
                        aria-label={`Papel de ${m.full_name ?? m.email ?? m.user_id}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="secondary">{m.role}</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {m.accepted_at ? (
                    <Badge variant="default">Aceito</Badge>
                  ) : (
                    <Badge variant="outline">Pendente</Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {m.last_sign_in_at
                    ? new Date(m.last_sign_in_at).toLocaleString("pt-BR")
                    : "—"}
                </TableCell>
                {canManage ? (
                  <TableCell>
                    {m.user_id !== currentUserId ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Ações">
                            <DotsThree size={20} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setRevokeDialog(m)}
                          >
                            Revogar acesso
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <span className="text-xs text-muted-foreground">você</span>
                    )}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!revokeDialog} onOpenChange={(o) => !o && setRevokeDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revogar acesso</DialogTitle>
            <DialogDescription>
              {revokeDialog?.email ?? revokeDialog?.user_id} perderá acesso ao tenant. Esta ação
              pode ser desfeita reconvidando o membro.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRevokeDialog(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={revoke.isPending}
              onClick={async () => {
                if (!revokeDialog) return;
                try {
                  await revoke.mutateAsync(revokeDialog.user_id);
                  toast.success("Acesso revogado.");
                  setRevokeDialog(null);
                } catch {
                  /* showApiError already triggered by the hook */
                }
              }}
            >
              Revogar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
