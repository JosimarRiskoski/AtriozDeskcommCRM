-- 0137_google_calendar_bidirectional_sync
-- Eventos criados no Google podem existir sem contato do CRM. O sync token
-- mantém a importação incremental sem reler toda a agenda.

alter table public.calendar_appointments
  alter column contact_id drop not null;

alter table public.calendar_integrations
  add column if not exists events_sync_token text;

comment on column public.calendar_appointments.contact_id is
  'Opcional para eventos importados do Google. Lembretes WhatsApp exigem vínculo explícito.';
comment on column public.calendar_integrations.events_sync_token is
  'nextSyncToken da coleção Events do Google Calendar para sincronização incremental.';
