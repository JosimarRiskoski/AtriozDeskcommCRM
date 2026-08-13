"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarBlank, Plus } from "@/lib/ui/icons";

import { AppointmentDialog } from "./AppointmentDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { StepDialogForm } from "@/components/ui/step-dialog-form";

interface Appointment {
  id: string;
  title: string;
  status: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  meet_url: string | null;
  contacts?: { name?: string | null; display_name?: string | null; phone_number?: string | null } | null;
}

function toLocalDateTime(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function ManageAppointmentDialog({ appointment, onOpenChange, onUpdated }: {
  appointment: Appointment | null;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}) {
  const [step, setStep] = useState(0);
  const [startsAt, setStartsAt] = useState("");
  const [duration, setDuration] = useState("60");
  const [location, setLocation] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!appointment) return;
    setStep(0);
    setStartsAt(toLocalDateTime(appointment.starts_at));
    setDuration(String(Math.max(5, Math.round((new Date(appointment.ends_at).getTime() - new Date(appointment.starts_at).getTime()) / 60000))));
    setLocation(appointment.location ?? "");
    setConfirmed(false);
  }, [appointment]);

  async function update(action: "reschedule" | "cancel" | "complete") {
    if (!appointment || !confirmed) return;
    setSubmitting(true);
    try {
      const start = new Date(startsAt);
      const body = action === "reschedule"
        ? {
            action,
            confirmed: true,
            starts_at: start.toISOString(),
            ends_at: new Date(start.getTime() + Number(duration) * 60000).toISOString(),
            timezone: "America/Sao_Paulo",
            location: location || null,
          }
        : { action, confirmed: true };
      const response = await fetch(`/api/v1/calendar/appointments/${appointment.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(json.error?.message || "Não foi possível atualizar o compromisso.");
      toast.success(action === "cancel" ? "Compromisso cancelado." : action === "complete" ? "Compromisso concluído." : "Compromisso remarcado.");
      onOpenChange(false);
      onUpdated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar o compromisso.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={Boolean(appointment)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Gerenciar compromisso</DialogTitle>
          <DialogDescription>Remarque, conclua ou cancele com confirmação explícita.</DialogDescription>
        </DialogHeader>
        <StepDialogForm
          labels={["Nova data", "Confirmar"]}
          currentStep={step}
          onSubmit={(event) => { event.preventDefault(); void update("reschedule"); }}
          footer={
            <DialogFooter className="gap-2 sm:justify-between">
              <div className="flex gap-2">
                <Button type="button" variant="destructive" disabled={!confirmed || submitting} onClick={() => void update("cancel")}>Cancelar compromisso</Button>
                <Button type="button" variant="outline" disabled={!confirmed || submitting} onClick={() => void update("complete")}>Concluir</Button>
              </div>
              {step === 0 ? <Button type="button" onClick={() => setStep(1)}>Revisar remarcação</Button> : <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setStep(0)}>Voltar</Button><Button type="submit" disabled={!confirmed || submitting}>Confirmar nova data</Button></div>}
            </DialogFooter>
          }
        >
          <div className={step === 0 ? "space-y-4" : "hidden"}>
            <div className="space-y-2"><Label htmlFor="manage-appointment-start">Data e hora</Label><Input id="manage-appointment-start" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="manage-appointment-duration">Duração em minutos</Label><Input id="manage-appointment-duration" type="number" min={5} value={duration} onChange={(event) => setDuration(event.target.value)} /></div>
            {!appointment?.meet_url ? <div className="space-y-2"><Label htmlFor="manage-appointment-location">Endereço ou local</Label><Input id="manage-appointment-location" value={location} onChange={(event) => setLocation(event.target.value)} /></div> : null}
          </div>
          <div className={step === 1 ? "space-y-4" : "hidden"}>
            <div className="rounded-md border p-4 text-sm"><div className="font-semibold">{appointment?.title}</div><div className="mt-2">{startsAt ? new Date(startsAt).toLocaleString("pt-BR") : "Data não informada"}</div><div>{appointment?.meet_url ? "Google Meet" : location || "Local não informado"}</div></div>
          </div>
          <label className="mt-4 flex items-start gap-3 rounded-md border p-4 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>Confirmo esta alteração no Google Agenda e nos lembretes do WhatsApp.</span></label>
        </StepDialogForm>
      </DialogContent>
    </Dialog>
  );
}

export function AgendaClient() {
  const [open, setOpen] = useState(false);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const until = new Date(from.getTime() + 90 * 86400000);
      const response = await fetch(`/api/v1/calendar/appointments?from=${from.toISOString()}&until=${until.toISOString()}`);
      const json = (await response.json()) as { data?: Appointment[]; error?: { message?: string } };
      if (!response.ok) throw new Error(json.error?.message || "Não foi possível carregar a agenda.");
      setAppointments(json.data ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar a agenda.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agenda</h1>
          <p className="text-sm text-muted-foreground">Visitas, consultas e reuniões com lembretes pelo WhatsApp.</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus size={16} className="mr-2" />Novo compromisso</Button>
      </header>
      {loading ? <p className="text-sm text-muted-foreground">Carregando agenda…</p> : null}
      {error ? <Card className="p-4 text-sm text-destructive">{error}</Card> : null}
      {!loading && !error && appointments.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <CalendarBlank size={36} className="text-muted-foreground" />
          <div><div className="font-medium">Nenhum compromisso futuro</div><div className="text-sm text-muted-foreground">Crie o primeiro compromisso para um contato.</div></div>
          <Button variant="outline" onClick={() => setOpen(true)}>Criar compromisso</Button>
        </Card>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {appointments.map((appointment) => {
          const contact = Array.isArray(appointment.contacts) ? appointment.contacts[0] : appointment.contacts;
          return (
            <Card key={appointment.id} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3"><div className="font-semibold">{appointment.title}</div><Badge variant="outline">{appointment.status}</Badge></div>
              <div className="text-sm">{new Date(appointment.starts_at).toLocaleString("pt-BR")}</div>
              <div className="text-xs text-muted-foreground">{contact?.name || contact?.display_name || contact?.phone_number || "Contato"}</div>
              {appointment.meet_url ? <a href={appointment.meet_url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">Abrir Google Meet</a> : <div className="text-sm text-muted-foreground">{appointment.location || "Local não informado"}</div>}
              <Button type="button" variant="outline" size="sm" onClick={() => setSelectedAppointment(appointment)}>Gerenciar</Button>
            </Card>
          );
        })}
      </div>
      <AppointmentDialog open={open} onOpenChange={setOpen} onCreated={() => void load()} />
      <ManageAppointmentDialog appointment={selectedAppointment} onOpenChange={(value) => { if (!value) setSelectedAppointment(null); }} onUpdated={() => void load()} />
    </div>
  );
}
