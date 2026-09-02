"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";

import { AppointmentDialog } from "@/components/calendar/AppointmentDialog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { appointmentContactName, type CalendarAppointment } from "@/lib/calendar/types";
import { CalendarBlank, CaretLeft, CaretRight, Plus } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

export function AgendaQuickMenu() {
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [month, setMonth] = useState(startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(startOfDay(new Date()));
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);

  const load = useCallback(async () => {
    const calendarFrom = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
    const calendarUntil = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
    const today = new Date();
    const from = calendarFrom < startOfDay(today) ? calendarFrom : startOfDay(today);
    const until = calendarUntil > endOfDay(today) ? calendarUntil : endOfDay(today);
    try {
      const response = await fetch(
        `/api/v1/calendar/appointments?from=${from.toISOString()}&until=${until.toISOString()}`,
        { cache: "no-store" },
      );
      const json = (await response.json()) as { data?: CalendarAppointment[] };
      if (response.ok) setAppointments(json.data ?? []);
    } catch {
      // A agenda rapida nao interrompe a navegacao principal.
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "hidden") void load();
    };
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("calendar:refresh", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("calendar:refresh", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(month), { weekStartsOn: 0 }),
        end: endOfWeek(endOfMonth(month), { weekStartsOn: 0 }),
      }),
    [month],
  );
  const selectedAppointments = appointments.filter((appointment) =>
    isSameDay(new Date(appointment.starts_at), selectedDate),
  );
  const remainingToday = appointments.filter(
    (appointment) =>
      isToday(new Date(appointment.starts_at)) &&
      new Date(appointment.ends_at) >= new Date() &&
      !["cancelled", "completed"].includes(appointment.status),
  ).length;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Agenda - ${remainingToday} compromissos restantes hoje`}
            title={`Agenda - ${remainingToday} compromissos restantes hoje`}
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <CalendarBlank size={19} aria-hidden />
            {remainingToday > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
                {remainingToday > 99 ? "99+" : remainingToday}
              </span>
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
          <div className="flex items-center justify-between border-b p-3">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => setMonth((value) => addMonths(value, -1))}
            >
              <CaretLeft size={16} />
            </Button>
            <div className="font-semibold capitalize">
              {format(month, "MMMM 'de' yyyy", { locale: ptBR })}
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => setMonth((value) => addMonths(value, 1))}
            >
              <CaretRight size={16} />
            </Button>
          </div>
          <div className="p-3">
            <div className="grid grid-cols-7 text-center text-[11px] font-medium text-muted-foreground">
              {["D", "S", "T", "Q", "Q", "S", "S"].map((label, index) => (
                <div key={`${label}-${index}`} className="py-1">
                  {label}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {days.map((day) => {
                const count = appointments.filter((appointment) =>
                  isSameDay(new Date(appointment.starts_at), day),
                ).length;
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => setSelectedDate(day)}
                    className={cn(
                      "relative flex h-9 items-center justify-center rounded-md text-xs hover:bg-muted",
                      !isSameMonth(day, month) && "text-muted-foreground/45",
                      isSameDay(day, selectedDate) &&
                        "bg-primary text-primary-foreground hover:bg-primary",
                      isToday(day) && !isSameDay(day, selectedDate) && "font-bold text-primary",
                    )}
                  >
                    {format(day, "d")}
                    {count ? (
                      <span
                        className={cn(
                          "absolute bottom-0.5 h-1 w-1 rounded-full bg-primary",
                          isSameDay(day, selectedDate) && "bg-primary-foreground",
                        )}
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="border-t p-3">
            <div className="mb-2 text-sm font-semibold capitalize">
              {isToday(selectedDate)
                ? "Hoje"
                : format(selectedDate, "EEEE, dd/MM", { locale: ptBR })}
            </div>
            <div className="max-h-44 space-y-2 overflow-y-auto">
              {selectedAppointments.length ? (
                selectedAppointments.map((appointment) => (
                  <div key={appointment.id} className="rounded-md border p-2 text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="truncate font-medium">{appointment.title}</span>
                      <span className="tabular-nums">
                        {format(new Date(appointment.starts_at), "HH:mm")}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-muted-foreground">
                      {appointmentContactName(appointment)} ·{" "}
                      {appointment.meet_url
                        ? "Google Meet"
                        : appointment.location || "Local nao informado"}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                  Nenhum compromisso neste dia.
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2 border-t p-3">
            <Button
              type="button"
              size="sm"
              className="flex-1"
              onClick={() => {
                setOpen(false);
                setCreateOpen(true);
              }}
            >
              <Plus size={14} className="mr-1" /> Novo
            </Button>
            <Button asChild size="sm" variant="outline" className="flex-1">
              <Link href="/app/calendar" onClick={() => setOpen(false)}>
                Abrir Agenda
              </Link>
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <AppointmentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialStartsAt={selectedDate}
        onCreated={() => {
          window.dispatchEvent(new Event("calendar:refresh"));
        }}
      />
    </>
  );
}
