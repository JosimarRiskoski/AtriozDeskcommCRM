"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StepDialogForm } from "@/components/ui/step-dialog-form";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

interface ContactOption {
  id: string;
  name: string | null;
  display_name: string | null;
  phone_number: string | null;
  email: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId?: string | null;
  conversationId?: string | null;
  leadId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  onCreated?: () => void;
}

function initialDateTime() {
  const date = new Date(Date.now() + 86400000);
  date.setMinutes(0, 0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function AppointmentDialog({
  open,
  onOpenChange,
  contactId: fixedContactId,
  conversationId = null,
  leadId = null,
  contactName,
  contactPhone,
  contactEmail,
  onCreated,
}: Props) {
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [contactId, setContactId] = useState(fixedContactId ?? "");
  const [title, setTitle] = useState(contactName ? `Compromisso com ${contactName}` : "");
  const [type, setType] = useState("visit");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState(initialDateTime);
  const [duration, setDuration] = useState("60");
  const [location, setLocation] = useState("");
  const [createMeet, setCreateMeet] = useState(false);
  const [attendeeEmail, setAttendeeEmail] = useState(contactEmail ?? "");
  const [reminder24h, setReminder24h] = useState(true);
  const [reminder1h, setReminder1h] = useState(true);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setConfirmed(false);
    setContactId(fixedContactId ?? "");
    setTitle(contactName ? `Compromisso com ${contactName}` : "");
    setAttendeeEmail(contactEmail ?? "");
  }, [open, fixedContactId, contactName, contactEmail]);

  useEffect(() => {
    if (!open || fixedContactId || contactSearch.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/v1/contacts?search=${encodeURIComponent(contactSearch.trim())}&limit=20`,
          { signal: controller.signal },
        );
        const json = (await response.json()) as { data?: ContactOption[] };
        if (response.ok) setContacts(json.data ?? []);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setContacts([]);
      }
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, fixedContactId, contactSearch]);

  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.id === contactId),
    [contacts, contactId],
  );
  const displayContact =
    contactName || selectedContact?.name || selectedContact?.display_name || contactPhone || "Contato";

  async function createAppointment() {
    if (!confirmed) return;
    setSubmitting(true);
    try {
      const start = new Date(startsAt);
      const end = new Date(start.getTime() + Number(duration) * 60000);
      const response = await fetch("/api/v1/calendar/appointments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmed: true,
          contact_id: contactId,
          conversation_id: conversationId,
          lead_id: leadId,
          appointment_type: type,
          title,
          description: description || null,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          timezone: "America/Sao_Paulo",
          location: createMeet ? null : location || null,
          attendee_email: attendeeEmail || null,
          create_meet: createMeet,
          reminder_24h_enabled: reminder24h,
          reminder_1h_enabled: reminder1h,
        }),
      });
      const json = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(json.error?.message || "Não foi possível agendar.");
      toast.success("Compromisso criado no Google Agenda.");
      onOpenChange(false);
      onCreated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível agendar.");
    } finally {
      setSubmitting(false);
    }
  }

  const canContinueStep0 = Boolean(contactId && title.trim().length >= 2);
  const canContinueStep1 = Boolean(startsAt && Number(duration) >= 5 && (createMeet || location.trim()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo compromisso</DialogTitle>
          <DialogDescription>
            Crie uma visita, consulta ou reunião online vinculada ao contato.
          </DialogDescription>
        </DialogHeader>
        <StepDialogForm
          labels={["Contato", "Horário", "Confirmar"]}
          currentStep={step}
          onSubmit={(event) => {
            event.preventDefault();
            void createAppointment();
          }}
          footer={
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              {step > 0 ? (
                <Button type="button" variant="outline" onClick={() => setStep((value) => value - 1)}>
                  Voltar
                </Button>
              ) : null}
              {step < 2 ? (
                <Button
                  type="button"
                  disabled={step === 0 ? !canContinueStep0 : !canContinueStep1}
                  onClick={() => setStep((value) => value + 1)}
                >
                  Continuar
                </Button>
              ) : (
                <Button type="submit" disabled={!confirmed || submitting}>
                  {submitting ? "Agendando…" : "Confirmar agendamento"}
                </Button>
              )}
            </DialogFooter>
          }
        >
          <div className={step === 0 ? "space-y-4" : "hidden"}>
            {fixedContactId ? (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="font-medium">{displayContact}</div>
                {contactPhone ? <div className="text-muted-foreground">{contactPhone}</div> : null}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="appointment-contact-search">Contato</Label>
                <Input
                  id="appointment-contact-search"
                  value={contactSearch}
                  onChange={(event) => setContactSearch(event.target.value)}
                  placeholder="Busque por nome ou telefone"
                />
                {contacts.length ? (
                  <div className="max-h-40 overflow-y-auto rounded-md border p-1">
                    {contacts.map((contact) => (
                      <button
                        key={contact.id}
                        type="button"
                        onClick={() => {
                          setContactId(contact.id);
                          setAttendeeEmail(contact.email ?? "");
                          if (!title) setTitle(`Compromisso com ${contact.name || contact.display_name || contact.phone_number}`);
                        }}
                        className={`block w-full rounded px-2 py-2 text-left text-sm hover:bg-accent ${contactId === contact.id ? "bg-accent" : ""}`}
                      >
                        <span className="font-medium">{contact.name || contact.display_name || "Sem nome"}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{contact.phone_number}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="appointment-title">Título</Label>
              <Input id="appointment-title" value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="visit">Visita</SelectItem>
                  <SelectItem value="consultation">Consulta</SelectItem>
                  <SelectItem value="online">Reunião online</SelectItem>
                  <SelectItem value="other">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="appointment-description">Observações</Label>
              <Textarea id="appointment-description" value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>
          </div>

          <div className={step === 1 ? "space-y-4" : "hidden"}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="appointment-start">Data e hora</Label>
                <Input id="appointment-start" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Duração</Label>
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 minutos</SelectItem>
                    <SelectItem value="60">1 hora</SelectItem>
                    <SelectItem value="90">1h30</SelectItem>
                    <SelectItem value="120">2 horas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div><div className="text-sm font-medium">Criar Google Meet</div><div className="text-xs text-muted-foreground">O link será incluído nos lembretes fixos.</div></div>
              <Switch checked={createMeet} onCheckedChange={setCreateMeet} />
            </div>
            {!createMeet ? (
              <div className="space-y-2">
                <Label htmlFor="appointment-location">Endereço ou local</Label>
                <Input id="appointment-location" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Rua, número, cidade" />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="appointment-email">E-mail do convidado (opcional)</Label>
              <Input id="appointment-email" type="email" value={attendeeEmail} onChange={(event) => setAttendeeEmail(event.target.value)} />
            </div>
          </div>

          <div className={step === 2 ? "space-y-4" : "hidden"}>
            <div className="rounded-md border p-4 text-sm">
              <div className="font-semibold">{title}</div>
              <div className="mt-1 text-muted-foreground">{displayContact}</div>
              <div className="mt-2">{new Date(startsAt).toLocaleString("pt-BR")}</div>
              <div>{createMeet ? "Google Meet" : location}</div>
            </div>
            <div className="space-y-2 rounded-md border p-4">
              <div className="font-medium">Lembretes fixos pelo WhatsApp</div>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>1 dia antes</span><Switch checked={reminder24h} onCheckedChange={setReminder24h} />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>1 hora antes</span><Switch checked={reminder1h} onCheckedChange={setReminder1h} />
              </label>
              <p className="text-xs text-muted-foreground">O texto é definido em Configurações → Google Agenda. A IA não cria frases para esses avisos.</p>
            </div>
            <label className="flex items-start gap-3 rounded-md border p-4 text-sm">
              <input type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span>Confirmo a criação deste compromisso no Google Agenda e o envio dos lembretes selecionados.</span>
            </label>
          </div>
        </StepDialogForm>
      </DialogContent>
    </Dialog>
  );
}
