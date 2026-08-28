export type AppointmentStatus = "scheduled" | "rescheduled" | "cancelled" | "completed" | "no_show";
export type AppointmentType = "visit" | "consultation" | "online" | "other";

export interface CalendarAppointment {
  id: string;
  title: string;
  status: AppointmentStatus;
  appointment_type: AppointmentType;
  starts_at: string;
  ends_at: string;
  location: string | null;
  meet_url: string | null;
  assigned_user_id: string | null;
  contacts?: {
    name?: string | null;
    display_name?: string | null;
    phone_number?: string | null;
  } | null;
}

export type CalendarView = "month" | "week" | "day" | "list";

export function appointmentContactName(appointment: CalendarAppointment) {
  const contact = Array.isArray(appointment.contacts)
    ? appointment.contacts[0]
    : appointment.contacts;
  return contact?.name || contact?.display_name || contact?.phone_number || "Evento externo do Google";
}

export const appointmentStatusLabels: Record<AppointmentStatus, string> = {
  scheduled: "Agendado",
  rescheduled: "Remarcado",
  cancelled: "Cancelado",
  completed: "Concluido",
  no_show: "Nao compareceu",
};

export const appointmentTypeLabels: Record<AppointmentType, string> = {
  visit: "Visita",
  consultation: "Consulta",
  online: "Reuniao online",
  other: "Outro",
};
