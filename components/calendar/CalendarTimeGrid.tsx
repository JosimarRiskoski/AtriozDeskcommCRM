"use client";

import { addDays, differenceInMinutes, format, isSameDay, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { appointmentContactName, type CalendarAppointment } from "@/lib/calendar/types";

const FIRST_HOUR = 7;
const LAST_HOUR = 21;
const SLOT_MINUTES = 30;
const HOUR_HEIGHT = 56;
const slots = Array.from(
  { length: ((LAST_HOUR - FIRST_HOUR) * 60) / SLOT_MINUTES },
  (_, index) => FIRST_HOUR * 60 + index * SLOT_MINUTES,
);

function dateAtMinutes(day: Date, minutes: number) {
  const result = new Date(day);
  result.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return result;
}

function position(appointment: CalendarAppointment) {
  const start = new Date(appointment.starts_at);
  const end = new Date(appointment.ends_at);
  const minutes = start.getHours() * 60 + start.getMinutes() - FIRST_HOUR * 60;
  const duration = Math.max(differenceInMinutes(end, start), 15);
  return {
    top: (minutes / 60) * HOUR_HEIGHT,
    height: Math.max((duration / 60) * HOUR_HEIGHT - 2, 22),
  };
}

export function CalendarTimeGrid({
  days,
  appointments,
  onCreate,
  onSelect,
  onRequestReschedule,
}: {
  days: Date[];
  appointments: CalendarAppointment[];
  onCreate: (date: Date) => void;
  onSelect: (appointment: CalendarAppointment) => void;
  onRequestReschedule: (appointment: CalendarAppointment, startsAt: Date) => void;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const start = startOfWeek(days[0] ?? new Date(), { weekStartsOn: 0 });
  const visibleDays = days.length === 1 ? days : Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <div className="overflow-auto rounded-lg border bg-card">
      <div className="grid min-w-[760px]" style={{ gridTemplateColumns: `56px repeat(${visibleDays.length}, minmax(100px, 1fr))` }}>
        <div className="sticky left-0 top-0 z-30 border-b border-r bg-card" />
        {visibleDays.map((day) => (
          <div key={day.toISOString()} className="sticky top-0 z-20 border-b border-r bg-card px-2 py-2 text-center last:border-r-0">
            <div className="text-xs uppercase text-muted-foreground">{format(day, "EEE", { locale: ptBR })}</div>
            <div className="font-semibold">{format(day, "dd/MM")}</div>
          </div>
        ))}

        <div className="sticky left-0 z-20 border-r bg-card">
          {Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, index) => FIRST_HOUR + index).map((hour) => (
            <div key={hour} className="relative border-b text-right text-[10px] text-muted-foreground" style={{ height: HOUR_HEIGHT }}>
              <span className="absolute -top-1.5 right-1">{String(hour).padStart(2, "0")}:00</span>
            </div>
          ))}
        </div>

        {visibleDays.map((day) => {
          const dayAppointments = appointments.filter((appointment) => isSameDay(new Date(appointment.starts_at), day));
          return (
            <div key={day.toISOString()} className="relative border-r last:border-r-0" style={{ height: (LAST_HOUR - FIRST_HOUR) * HOUR_HEIGHT }}>
              {slots.map((minutes) => {
                const date = dateAtMinutes(day, minutes);
                const key = `${format(day, "yyyy-MM-dd")}-${minutes}`;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={`Agendar em ${format(date, "dd/MM 'às' HH:mm")}`}
                    onClick={() => onCreate(date)}
                    onDragOver={(event) => { event.preventDefault(); setTarget(key); }}
                    onDragLeave={() => setTarget((current) => current === key ? null : current)}
                    onDrop={(event) => {
                      event.preventDefault();
                      const id = event.dataTransfer.getData("text/calendar-appointment") || draggedId;
                      const appointment = appointments.find((item) => item.id === id);
                      setDraggedId(null);
                      setTarget(null);
                      if (appointment) onRequestReschedule(appointment, date);
                    }}
                    className={cn(
                      "absolute inset-x-0 border-b border-dashed border-border/50 text-left transition-colors hover:bg-primary/5",
                      target === key && "bg-primary/15 ring-1 ring-inset ring-primary",
                    )}
                    style={{ top: ((minutes - FIRST_HOUR * 60) / 60) * HOUR_HEIGHT, height: (SLOT_MINUTES / 60) * HOUR_HEIGHT }}
                  />
                );
              })}
              {dayAppointments.map((appointment) => {
                const imported = appointment.metadata?.imported_from_google === true && !appointment.contact_id;
                const pos = position(appointment);
                return (
                  <button
                    key={appointment.id}
                    type="button"
                    draggable={!imported && appointment.status !== "cancelled"}
                    onDragStart={(event) => {
                      setDraggedId(appointment.id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/calendar-appointment", appointment.id);
                    }}
                    onDragEnd={() => { setDraggedId(null); setTarget(null); }}
                    onClick={() => onSelect(appointment)}
                    className={cn(
                      "absolute inset-x-1 z-10 overflow-hidden rounded-md border-l-4 border-l-primary bg-primary/10 px-2 py-1 text-left text-xs shadow-sm",
                      !imported && appointment.status !== "cancelled" && "cursor-grab active:cursor-grabbing",
                      imported && "cursor-default border-l-muted-foreground bg-muted",
                      appointment.status === "cancelled" && "opacity-50",
                      draggedId === appointment.id && "opacity-40",
                    )}
                    style={{ top: pos.top, height: pos.height }}
                    title={imported ? "Ocupação importada do Google Agenda" : "Arraste para remarcar"}
                  >
                    <div className="truncate font-semibold">{appointment.title}</div>
                    <div className="truncate text-muted-foreground">{format(new Date(appointment.starts_at), "HH:mm")} · {appointmentContactName(appointment)}</div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
