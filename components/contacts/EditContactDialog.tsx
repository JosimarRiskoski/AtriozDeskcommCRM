"use client";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { contactPatchSchema, type ContactPatch } from "@/lib/schemas/contacts";
import { useUpdateContact } from "@/hooks/contacts/useUpdateContact";
import type { Contact } from "@/lib/types/contacts";

interface FormShape {
  name?: string;
  email?: string;
  phone_number?: string;
  company?: string;
  city?: string;
  state?: string;
  tagsRaw?: string;
}

interface Props {
  contact: Contact;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function EditContactDialog({ contact, open, onOpenChange }: Props) {
  const update = useUpdateContact(contact.id);
  const [serverError, setServerError] = useState<string | null>(null);
  const [customFields, setCustomFields] = useState<Array<{ key: string; value: string }>>(
    Object.entries(contact.custom_fields ?? {}).map(([key, value]) => ({
      key,
      value: value == null ? "" : String(value),
    })),
  );

  const form = useForm<FormShape>({
    defaultValues: {
      name: contact.name ?? "",
      email: contact.email ?? "",
      phone_number: contact.phone_number ?? "",
      company: contact.company ?? "",
      city: contact.city ?? "",
      state: contact.state ?? "",
      tagsRaw: contact.tags.join(", "),
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: contact.name ?? "",
        email: contact.email ?? "",
        phone_number: contact.phone_number ?? "",
        company: contact.company ?? "",
        city: contact.city ?? "",
        state: contact.state ?? "",
        tagsRaw: contact.tags.join(", "),
      });
    }
  }, [open, contact, form]);

  async function onSubmit(values: FormShape) {
    setServerError(null);
    const tags = (values.tagsRaw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const payload: Record<string, unknown> = {};
    if (values.name?.trim()) payload.name = values.name.trim();
    if (values.email?.trim()) payload.email = values.email.trim();
    if (values.phone_number?.trim()) payload.phone_number = values.phone_number.trim();
    payload.company = values.company?.trim() ?? "";
    payload.city = values.city?.trim() ?? "";
    payload.state = values.state?.trim().toUpperCase() ?? "";
    payload.tags = tags;
    payload.custom_fields = Object.fromEntries(
      customFields.flatMap((item): Array<[string, string]> => {
        const key = item.key.trim();
        return key ? [[key, item.value]] : [];
      }),
    );

    const parsed = contactPatchSchema.safeParse(payload);
    if (!parsed.success) {
      setServerError(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }
    try {
      await update.mutateAsync(parsed.data as ContactPatch);
      toast.success("Contato atualizado");
      onOpenChange(false);
    } catch {
      // hook handles toast
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar contato</DialogTitle>
          <DialogDescription>Atualize os dados deste contato.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ec-name">Nome</Label>
            <Input id="ec-name" {...form.register("name")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ec-email">Email</Label>
            <Input id="ec-email" type="email" {...form.register("email")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ec-phone">Telefone (E.164)</Label>
            <Input id="ec-phone" {...form.register("phone_number")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ec-company">Empresa</Label>
            <Input id="ec-company" {...form.register("company")} />
          </div>
          <div className="grid grid-cols-[1fr_90px] gap-3">
            <div className="space-y-2">
              <Label htmlFor="ec-city">Cidade</Label>
              <Input id="ec-city" {...form.register("city")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ec-state">UF</Label>
              <Input id="ec-state" maxLength={2} {...form.register("state")} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ec-tags">Tags</Label>
            <Input id="ec-tags" {...form.register("tagsRaw")} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Campos personalizados</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setCustomFields((items) => [...items, { key: "", value: "" }])}
              >
                Adicionar campo
              </Button>
            </div>
            {customFields.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum campo personalizado.</p>
            ) : (
              customFields.map((field, index) => (
                <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <Input
                    value={field.key}
                    onChange={(e) =>
                      setCustomFields((items) =>
                        items.map((item, i) =>
                          i === index ? { ...item, key: e.target.value } : item,
                        ),
                      )
                    }
                    placeholder="Nome do campo"
                    aria-label={`Nome do campo personalizado ${index + 1}`}
                  />
                  <Input
                    value={field.value}
                    onChange={(e) =>
                      setCustomFields((items) =>
                        items.map((item, i) =>
                          i === index ? { ...item, value: e.target.value } : item,
                        ),
                      )
                    }
                    placeholder="Valor"
                    aria-label={`Valor do campo personalizado ${index + 1}`}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setCustomFields((items) => items.filter((_, i) => i !== index))}
                  >
                    Remover
                  </Button>
                </div>
              ))
            )}
          </div>
          {serverError && <p className="text-sm text-error-fg">{serverError}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={update.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
