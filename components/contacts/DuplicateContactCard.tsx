"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface Candidate {
  id: string;
  name: string | null;
  display_name: string | null;
  email: string | null;
  phone_number: string | null;
  source: string;
  created_at: string;
  last_activity_at: string | null;
}

export function DuplicateContactCard({
  contactId,
  currentName,
}: {
  contactId: string;
  currentName: string;
}) {
  const router = useRouter();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [primaryId, setPrimaryId] = useState(contactId);
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void apiClient
      .get<{ data: Candidate[] }>(`/api/v1/contacts/${contactId}/duplicates`)
      .then((response) => setCandidates(response.data))
      .catch(() => undefined);
  }, [contactId]);

  if (!candidates.length) return null;

  async function merge() {
    if (!selected) return;
    setPending(true);
    try {
      const duplicateId = primaryId === contactId ? selected.id : contactId;
      await apiClient.post(`/api/v1/contacts/${contactId}/duplicates`, {
        primary_contact_id: primaryId,
        duplicate_contact_id: duplicateId,
      });
      toast.success("Contatos mesclados com segurança.");
      if (primaryId !== contactId) router.replace(`/app/contacts/${primaryId}`);
      else router.refresh();
      setSelected(null);
      setCandidates((items) => items.filter((item) => item.id !== duplicateId));
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.message
          ? error.message
          : "A mesclagem foi bloqueada para preservar os dados.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Card className="space-y-3 border-warning p-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Possível contato duplicado</h2>
            <Badge variant="warning">Revisão manual</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Encontramos telefone com diferença apenas no nono dígito. Nada será mesclado
            automaticamente.
          </p>
        </div>
        {candidates.map((candidate) => (
          <div
            key={candidate.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
          >
            <div>
              <p className="font-medium">
                {candidate.name || candidate.display_name || "Sem nome"}
              </p>
              <p className="text-muted-foreground">
                {candidate.phone_number || "Sem telefone"} · origem {candidate.source}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelected(candidate);
                setPrimaryId(contactId);
                setConfirmation("");
              }}
            >
              Comparar e mesclar
            </Button>
          </div>
        ))}
      </Card>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Escolher o contato principal</DialogTitle>
            <DialogDescription>
              O histórico será movido para o principal. A operação será recusada se houver conflito
              de conversas, cadências ou estado da IA.
            </DialogDescription>
          </DialogHeader>
          {selected ? (
            <div className="space-y-4">
              <label className="flex cursor-pointer gap-3 rounded-md border p-3 text-sm">
                <input
                  type="radio"
                  name="primary-contact"
                  checked={primaryId === contactId}
                  onChange={() => setPrimaryId(contactId)}
                />
                <span>
                  <strong>{currentName}</strong>
                  <span className="block text-muted-foreground">
                    Manter este contato como principal
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer gap-3 rounded-md border p-3 text-sm">
                <input
                  type="radio"
                  name="primary-contact"
                  checked={primaryId === selected.id}
                  onChange={() => setPrimaryId(selected.id)}
                />
                <span>
                  <strong>{selected.name || selected.display_name || selected.phone_number}</strong>
                  <span className="block text-muted-foreground">
                    Manter o contato encontrado como principal
                  </span>
                </span>
              </label>
              <div className="space-y-2">
                <p className="text-sm">
                  Digite <strong>MESCLAR</strong> para confirmar.
                </p>
                <Input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setSelected(null)}>
                  Cancelar
                </Button>
                <Button
                  disabled={pending || confirmation !== "MESCLAR"}
                  onClick={() => void merge()}
                >
                  {pending ? "Mesclando…" : "Mesclar contatos"}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
