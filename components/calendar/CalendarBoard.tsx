"use client";

import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  appointmentContactName,
  type CalendarAppointment,
  type CalendarView,
} from "@/lib/calendar/types";

const statusColor: Record<CalendarAppointment["status"], string> = {
  scheduled: "border-l-primary bg-primary/8",
  rescheduled: "border-l-amber-500 bg-amber-500/10",
  cancelled: "border-l-destructive bg-destructive/8 opacity-65",
  completed: "border-l-emerald-500 bg-emerald-500/10",
  no_show: "border-l-slate-500 bg-slate-500/10",
};

function EventButton({
  appointment,
  compact = false,
  onSelect,
}: {
  appointment: CalendarAppointment;
  compact?: boolean;
  onSelect: (appointment: CalendarAppointment) => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onSelect(appointment);
      }}
      className={cn(
        "w-full rounded border-l-4 px-2 py-1.5 text-left text-xs transition hover:brightness-110",
        statusColor[appointment.status],
      )}
      title={`${appointment.title} - ${appointmentContactName(appointment)}`}
    >
      <div className="flex items-center gap-1">
        <span className="shrink-0 font-medium tabular-nums">
          {format(new Date(appointment.starts_at), "HH:mm")}
        </span>
        <span className="truncate font-medium">{appointment.title}</span>
      </div>
      {!compact ? (
        <div className="mt-0.5 truncate text-muted-foreground">
          {appointmentContactName(appointment)}
        </div>
      ) : null}
    </button>
  );
}

function DayColumn({
  date,
  appointments,
  currentMonth,
  onSelect,
  onCreate,
}: {
  date: Date;
  appointments: CalendarAppointment[];
  currentMonth?: Date;
  onSelect: (appointment: CalendarAppointment) => void;
  onCreate: (date: Date) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onCreate(date)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onCreate(date);
      }}
      className={cn(
        "hover:bg-muted/30 min-h-28 border-b border-r p-1.5 transition",
        currentMonth && !isSameMonth(date, currentMonth) && "bg-muted/15 text-muted-foreground",
        isToday(date) && "bg-primary/5",
      )}
    >
      <div
        className={cn(
          "mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
          isToday(date) && "bg-primary text-primary-foreground",
        )}
      >
        {format(date, "d")}
      </div>
      <div className="space-y-1">
        {appointments.slice(0, 3).map((appointment) => (
          <EventButton key={appointment.id} appointment={appointment} compact onSelect={onSelect} />
        ))}
        {appointments.length > 3 ? (
          <div className="px-1 text-[11px] text-muted-foreground">
            +{appointments.length - 3} compromissos
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function CalendarBoard({
  view,
  focusDate,
  appointments,
  onSelect,
  onCreate,
}: {
  view: CalendarView;
  focusDate: Date;
  appointments: CalendarAppointment[];
  onSelect: (appointment: CalendarAppointment) => void;
  onCreate: (date: Date) => void;
}) {
  const forDay = (date: Date) =>
    appointments.filter((appointment) => isSameDay(new Date(appointment.starts_at), date));

  if (view === "month") {
    const start = startOfWeek(startOfMonth(focusDate), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(focusDate), { weekStartsOn: 0 });
    const days = eachDayOfInterval({ start, end });
    return (
      <Card className="overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="bg-muted/30 grid grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground">
            {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"].map((label) => (
              <div key={label} className="border-r px-1 py-2 last:border-r-0">
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((date) => (
              <DayColumn
                key={date.toISOString()}
                date={date}
                currentMonth={focusDate}
                appointments={forDay(date)}
                onSelect={onSelect}
                onCreate={onCreate}
              />
            ))}
          </div>
        </div>
      </Card>
    );
  }

  if (view === "week") {
    const start = startOfWeek(focusDate, { weekStartsOn: 0 });
    const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
    return (
      <Card className="overflow-x-auto">
        <div className="grid min-w-[760px] grid-cols-7">
          {days.map((date) => (
            <div key={date.toISOString()} className="min-h-[420px] border-r p-2 last:border-r-0">
              <button
                type="button"
                onClick={() => onCreate(date)}
                className="mb-3 w-full rounded-md py-2 text-center hover:bg-muted"
              >
                <div className="text-xs uppercase text-muted-foreground">
                  {format(date, "EEE", { locale: ptBR })}
                </div>
                <div
                  className={cn(
                    "mx-auto mt-1 flex h-8 w-8 items-center justify-center rounded-full font-semibold",
                    isToday(date) && "bg-primary text-primary-foreground",
                  )}
                >
                  {format(date, "d")}
                </div>
              </button>
              <div className="space-y-2">
                {forDay(date).map((appointment) => (
                  <EventButton key={appointment.id} appointment={appointment} onSelect={onSelect} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  const visible =
    view === "day"
      ? forDay(focusDate)
      : appointments.filter(
          (appointment) => new Date(appointment.starts_at) >= startOfMonth(focusDate),
        );
  const grouped = visible.reduce<Map<string, CalendarAppointment[]>>((map, appointment) => {
    const key = format(new Date(appointment.starts_at), "yyyy-MM-dd");
    map.set(key, [...(map.get(key) ?? []), appointment]);
    return map;
  }, new Map());

  return (
    <Card className="divide-y">
      {(view === "day"
        ? [[format(focusDate, "yyyy-MM-dd"), visible] as const]
        : Array.from(grouped.entries())
      ).map(([key, dayAppointments]) => {
        const date = new Date(`${key}T12:00:00`);
        return (
          <section key={key} className="grid gap-3 p-4 sm:grid-cols-[150px_1fr]">
            <button type="button" onClick={() => onCreate(date)} className="text-left">
              <div className="font-semibold capitalize">
                {format(date, "EEEE", { locale: ptBR })}
              </div>
              <div className="text-sm text-muted-foreground">
                {format(date, "dd 'de' MMMM", { locale: ptBR })}
              </div>
              {isToday(date) ? <Badge className="mt-2">Hoje</Badge> : null}
            </button>
            <div className="space-y-2">
              {dayAppointments.length ? (
                dayAppointments.map((appointment) => (
                  <EventButton key={appointment.id} appointment={appointment} onSelect={onSelect} />
                ))
              ) : (
                <button
                  type="button"
                  onClick={() => onCreate(date)}
                  className="hover:bg-muted/30 w-full rounded-md border border-dashed p-5 text-sm text-muted-foreground"
                >
                  Nenhum compromisso. Clique para agendar.
                </button>
              )}
            </div>
          </section>
        );
      })}
      {!visible.length && view === "list" ? (
        <div className="p-10 text-center text-sm text-muted-foreground">
          Nenhum compromisso neste periodo.
        </div>
      ) : null}
    </Card>
  );
}
