"use client";
import { useRouter } from "next/navigation";
import { formatRelative } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { Contact } from "@/lib/types/contacts";

interface Props {
  contacts: Contact[];
}

function displayName(c: Contact): string {
  return c.display_name?.trim() || c.name?.trim() || "—";
}

export function ContactsTable({ contacts }: Props) {
  const router = useRouter();

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nome</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Telefone</TableHead>
          <TableHead>Tags</TableHead>
          <TableHead>Última atividade</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {contacts.map((c) => (
          <TableRow
            key={c.id}
            className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            tabIndex={0}
            role="link"
            aria-label={`Abrir contato ${displayName(c)}`}
            onClick={() => router.push(`/app/contacts/${c.id}`)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                router.push(`/app/contacts/${c.id}`);
              }
            }}
          >
            <TableCell className="font-medium">{displayName(c)}</TableCell>
            <TableCell className="text-muted-foreground">{c.email ?? "—"}</TableCell>
            <TableCell className="text-muted-foreground">{c.phone_number ?? "—"}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {c.tags.length === 0 ? (
                  <span className="text-xs text-muted-foreground">—</span>
                ) : (
                  c.tags.map((t) => (
                    <Badge key={t} variant="neutral">
                      {t}
                    </Badge>
                  ))
                )}
              </div>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {c.last_activity_at
                ? formatRelative(new Date(c.last_activity_at), new Date(), { locale: ptBR })
                : "—"}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {c.is_anonymized && <Badge variant="destructive">Anonimizado</Badge>}
                {c.is_blocked && <Badge variant="warning">Bloqueado</Badge>}
                {!c.is_anonymized && !c.is_blocked && <Badge variant="success">Ativo</Badge>}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
