"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { CaretLeft, CaretRight, Plus } from "@/lib/ui/icons";

import { AppointmentDialog } from "./AppointmentDialog";
import { CalendarBoard } from "./CalendarBoard";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StepDialogForm } from "@/components/ui/step-dialog-form";
import {
  appointmentStatusLabels,
  appointmentTypeLabels,
  type CalendarAppointment,
  type CalendarView,
} from "@/lib/calendar/types";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";

type Appointment = CalendarAppointment;

function subscribeMobile(callback: () => void) {
  const media = window.matchMedia("(max-width: 640px)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function mobileSnapshot() {
  return window.matchMedia("(max-width: 640px)").matches;
}

function toLocalDateTime(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function ManageAppointmentDialog({
  appointment,
  onOpenChange,
  onUpdated,
}: {
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
    setDuration(
      String(
        Math.max(
          5,
          Math.round(
            (new Date(appointment.ends_at).getTime() - new Date(appointment.starts_at).getTime()) /
              60000,
          ),
        ),
      ),
    );
    setLocation(appointment.location ?? "");
    setConfirmed(false);
  }, [appointment]);

  async function update(action: "reschedule" | "cancel" | "complete" | "no_show") {
    if (!appointment || !confirmed) return;
    setSubmitting(true);
    try {
      const start = new Date(startsAt);
      const body =
        action === "reschedule"
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
      if (!response.ok)
        throw new Error(json.error?.message || "Não foi possível atualizar o compromisso.");
      toast.success(
        action === "cancel"
          ? "Compromisso cancelado."
          : action === "complete"
            ? "Compromisso concluído."
            : action === "no_show"
              ? "Ausência registrada."
              : "Compromisso remarcado.",
      );
      onOpenChange(false);
      onUpdated();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível atualizar o compromisso.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={Boolean(appointment)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Gerenciar compromisso</DialogTitle>
          <DialogDescription>
            Remarque, conclua ou cancele com confirmação explícita.
          </DialogDescription>
        </DialogHeader>
        <StepDialogForm
          labels={["Nova data", "Confirmar"]}
          currentStep={step}
          onSubmit={(event) => {
            event.preventDefault();
            void update("reschedule");
          }}
          footer={
            <DialogFooter className="gap-2 sm:justify-between">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={!confirmed || submitting}
                  onClick={() => void update("cancel")}
                >
                  Cancelar compromisso
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!confirmed || submitting}
                  onClick={() => void update("complete")}
                >
                  Concluir
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!confirmed || submitting}
                  onClick={() => void update("no_show")}
                >
                  Não compareceu
                </Button>
              </div>
              {step === 0 ? (
                <Button type="button" onClick={() => setStep(1)}>
                  Revisar remarcação
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setStep(0)}>
                    Voltar
                  </Button>
                  <Button type="submit" disabled={!confirmed || submitting}>
                    Confirmar nova data
                  </Button>
                </div>
              )}
            </DialogFooter>
          }
        >
          <div className={step === 0 ? "space-y-4" : "hidden"}>
            <div className="space-y-2">
              <Label htmlFor="manage-appointment-start">Data e hora</Label>
              <Input
                id="manage-appointment-start"
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manage-appointment-duration">Duração em minutos</Label>
              <Input
                id="manage-appointment-duration"
                type="number"
                min={5}
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              />
            </div>
            {!appointment?.meet_url ? (
              <div className="space-y-2">
                <Label htmlFor="manage-appointment-location">Endereço ou local</Label>
                <Input
                  id="manage-appointment-location"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                />
              </div>
            ) : null}
          </div>
          <div className={step === 1 ? "space-y-4" : "hidden"}>
            <div className="rounded-md border p-4 text-sm">
              <div className="font-semibold">{appointment?.title}</div>
              <div className="mt-2">
                {startsAt ? new Date(startsAt).toLocaleString("pt-BR") : "Data não informada"}
              </div>
              <div>{appointment?.meet_url ? "Google Meet" : location || "Local não informado"}</div>
            </div>
          </div>
          <label className="mt-4 flex items-start gap-3 rounded-md border p-4 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>Confirmo esta alteração no Google Agenda e nos lembretes do WhatsApp.</span>
          </label>
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
  const [createDate, setCreateDate] = useState<Date | null>(null);
  const [view, setView] = useState<CalendarView>("month");
  const [viewTouched, setViewTouched] = useState(false);
  const isMobile = useSyncExternalStore(subscribeMobile, mobileSnapshot, () => false);
  const effectiveView: CalendarView = isMobile && !viewTouched ? "list" : view;
  const [focusDate, setFocusDate] = useState(new Date());
  const [statusFilter, setStatusFilter] = useState("active");
  const [typeFilter, setTypeFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [search, setSearch] = useState("");
  const members = useAssignableMembers(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const from =
        effectiveView === "month" || effectiveView === "list"
          ? startOfWeek(startOfMonth(focusDate), { weekStartsOn: 0 })
          : effectiveView === "week"
            ? startOfWeek(focusDate, { weekStartsOn: 0 })
            : new Date(new Date(focusDate).setHours(0, 0, 0, 0));
      const until =
        effectiveView === "month" || effectiveView === "list"
          ? endOfWeek(endOfMonth(focusDate), { weekStartsOn: 0 })
          : effectiveView === "week"
            ? endOfWeek(focusDate, { weekStartsOn: 0 })
            : new Date(new Date(focusDate).setHours(23, 59, 59, 999));
      const response = await fetch(
        `/api/v1/calendar/appointments?from=${from.toISOString()}&until=${until.toISOString()}`,
      );
      const json = (await response.json()) as {
        data?: Appointment[];
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(json.error?.message || "Não foi possível carregar a agenda.");
      setAppointments(json.data ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar a agenda.");
    } finally {
      setLoading(false);
    }
  }, [effectiveView, focusDate]);
  useEffect(() => {
    void load();
  }, [load]);

  const filteredAppointments = appointments.filter((appointment) => {
    if (
      statusFilter === "active" &&
      ["cancelled", "completed", "no_show"].includes(appointment.status)
    )
      return false;
    if (statusFilter !== "all" && statusFilter !== "active" && appointment.status !== statusFilter)
      return false;
    if (typeFilter !== "all" && appointment.appointment_type !== typeFilter) return false;
    if (ownerFilter === "unassigned" && appointment.assigned_user_id) return false;
    if (
      ownerFilter !== "all" &&
      ownerFilter !== "unassigned" &&
      appointment.assigned_user_id !== ownerFilter
    )
      return false;
    if (search.trim()) {
      const contact = Array.isArray(appointment.contacts)
        ? appointment.contacts[0]
        : appointment.contacts;
      const haystack =
        `${appointment.title} ${contact?.name || ""} ${contact?.display_name || ""} ${contact?.phone_number || ""}`.toLowerCase();
      if (!haystack.includes(search.trim().toLowerCase())) return false;
    }
    return true;
  });

  function moveFocus(direction: -1 | 1) {
    setFocusDate((date) =>
      effectiveView === "month" || effectiveView === "list"
        ? addMonths(date, direction)
        : effectiveView === "week"
          ? addWeeks(date, direction)
          : addDays(date, direction),
    );
  }

  const periodLabel =
    effectiveView === "day"
      ? format(focusDate, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
      : effectiveView === "week"
        ? `Semana de ${format(startOfWeek(focusDate, { weekStartsOn: 0 }), "dd/MM")}`
        : format(focusDate, "MMMM 'de' yyyy", { locale: ptBR });

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agenda</h1>
          <p className="text-sm text-muted-foreground">
            Visitas, consultas e reuniões com lembretes pelo WhatsApp.
          </p>
        </div>
        <Button
          onClick={() => {
            setCreateDate(new Date());
            setOpen(true);
          }}
        >
          <Plus size={16} className="mr-2" />
          Novo compromisso
        </Button>
      </header>
      <Card className="space-y-3 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-9 w-9"
              onClick={() => moveFocus(-1)}
              aria-label="Período anterior"
            >
              <CaretLeft size={16} />
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => setFocusDate(new Date())}
            >
              Hoje
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-9 w-9"
              onClick={() => moveFocus(1)}
              aria-label="Próximo período"
            >
              <CaretRight size={16} />
            </Button>
            <div className="ml-2 min-w-40 font-semibold capitalize">{periodLabel}</div>
          </div>
          <div className="flex rounded-md border p-0.5">
            {(["month", "week", "day", "list"] as CalendarView[]).map((item) => (
              <Button
                key={item}
                type="button"
                size="sm"
                variant={effectiveView === item ? "default" : "ghost"}
                className="h-8 px-2 sm:px-3"
                onClick={() => {
                  setViewTouched(true);
                  setView(item);
                }}
              >
                {item === "month"
                  ? "Mês"
                  : item === "week"
                    ? "Semana"
                    : item === "day"
                      ? "Dia"
                      : "Lista"}
              </Button>
            ))}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar compromisso ou contato"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Somente ativos</SelectItem>
              <SelectItem value="all">Todos os status</SelectItem>
              {Object.entries(appointmentStatusLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              {Object.entries(appointmentTypeLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os responsáveis</SelectItem>
              <SelectItem value="unassigned">Sem responsável</SelectItem>
              {(members.data ?? []).map((member) => (
                <SelectItem key={member.user_id} value={member.user_id}>
                  {member.full_name || "Membro"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>
      {loading ? <p className="text-sm text-muted-foreground">Carregando agenda…</p> : null}
      {error ? <Card className="p-4 text-sm text-destructive">{error}</Card> : null}
      {!loading && !error ? (
        <CalendarBoard
          view={effectiveView}
          focusDate={focusDate}
          appointments={filteredAppointments}
          onSelect={setSelectedAppointment}
          onCreate={(date) => {
            setCreateDate(date);
            setOpen(true);
          }}
        />
      ) : null}
      <AppointmentDialog
        open={open}
        onOpenChange={setOpen}
        initialStartsAt={createDate}
        onCreated={() => {
          window.dispatchEvent(new Event("calendar:refresh"));
          void load();
        }}
      />
      <ManageAppointmentDialog
        appointment={selectedAppointment}
        onOpenChange={(value) => {
          if (!value) setSelectedAppointment(null);
        }}
        onUpdated={() => void load()}
      />
    </div>
  );
}
