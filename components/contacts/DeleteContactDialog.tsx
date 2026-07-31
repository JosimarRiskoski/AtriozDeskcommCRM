"use client";

import { useRouter } from "next/navigation";
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
import { useDeleteContact } from "@/hooks/contacts/useDeleteContact";

interface Props {
  contactId: string;
  contactName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteContactDialog({ contactId, contactName, open, onOpenChange }: Props) {
  const router = useRouter();
  const mutation = useDeleteContact();

  async function confirmDelete() {
    try {
      await mutation.mutateAsync(contactId);
      onOpenChange(false);
      router.replace("/app/contacts");
    } catch {
      // O hook exibe a mensagem segura, inclusive quando existe histÃ³rico.
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir {contactName}?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta aÃ§Ã£o remove permanentemente o contato quando ele ainda nÃ£o possui conversas ou
            mensagens. Contatos com histÃ³rico serÃ£o protegidos e deverÃ£o ser anonimizados pela
            LGPD.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void confirmDelete();
            }}
            disabled={mutation.isPending}
            className="hover:bg-destructive/90 bg-destructive text-destructive-foreground"
          >
            {mutation.isPending ? "Excluindoâ€¦" : "Excluir contato"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
