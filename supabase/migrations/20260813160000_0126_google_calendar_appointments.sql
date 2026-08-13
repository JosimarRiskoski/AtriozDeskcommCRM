-- 0126_google_calendar_appointments
-- Agenda por organizacao, OAuth Google Calendar e lembretes fixos via WhatsApp.

create table if not exists public.calendar_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  provider text not null default 'google_calendar' check (provider = 'google_calendar'),
  google_account_email text,
  oauth_access_token_encrypted bytea not null,
  oauth_refresh_token_encrypted bytea,
  scopes text[] not null default '{}'::text[],
  token_expires_at timestamptz,
  calendar_id text not null default 'primary',
  calendar_name text,
  status text not null default 'connected'
    check (status in ('connected','token_expired','scope_missing','disconnected','error')),
  last_error text,
  last_sync_at timestamptz,
  timezone text not null default 'America/Sao_Paulo',
  default_duration_minutes integer not null default 60
    check (default_duration_minutes between 5 and 1440),
  reminder_24h_enabled boolean not null default true,
  reminder_1h_enabled boolean not null default true,
  reminder_24h_template text not null default
    'Lembrete: seu compromisso está marcado para amanhã, {{data}} às {{hora}}. {{local_ou_link}}',
  reminder_1h_template text not null default
    'Lembrete: seu compromisso começa em 1 hora, às {{hora}}. {{local_ou_link}}',
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.calendar_appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid references public.calendar_integrations(id) on delete set null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  lead_id uuid references public.crm_leads(id) on delete set null,
  assigned_user_id uuid references auth.users(id) on delete set null,
  external_event_id text,
  external_calendar_id text,
  appointment_type text not null default 'visit'
    check (appointment_type in ('visit','consultation','online','other')),
  title text not null,
  description text,
  status text not null default 'scheduled'
    check (status in ('scheduled','rescheduled','cancelled','completed','no_show')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'America/Sao_Paulo',
  location text,
  meet_url text,
  attendee_email text,
  reminder_24h_enabled boolean not null default true,
  reminder_1h_enabled boolean not null default true,
  created_by_user_id uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancellation_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_appointments_valid_range check (ends_at > starts_at),
  constraint calendar_appointments_external_unique unique (organization_id, external_calendar_id, external_event_id)
);

create table if not exists public.calendar_reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid not null references public.calendar_appointments(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  reminder_kind text not null check (reminder_kind in ('24h','1h')),
  scheduled_for timestamptz not null,
  message_body text not null,
  status text not null default 'pending'
    check (status in ('pending','processing','sent','skipped','failed','cancelled')),
  claimed_at timestamptz,
  claimed_until timestamptz,
  attempts integer not null default 0,
  sent_message_id uuid references public.messages(id) on delete set null,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appointment_id, reminder_kind)
);

create index if not exists idx_calendar_appointments_org_starts
  on public.calendar_appointments(organization_id, starts_at);
create index if not exists idx_calendar_appointments_contact
  on public.calendar_appointments(organization_id, contact_id, starts_at desc);
create index if not exists idx_calendar_reminders_due
  on public.calendar_reminders(scheduled_for, id)
  where status in ('pending','failed');

drop trigger if exists trg_calendar_integrations_touch on public.calendar_integrations;
create trigger trg_calendar_integrations_touch
  before update on public.calendar_integrations
  for each row execute function public.fn_touch_updated_at();

drop trigger if exists trg_calendar_appointments_touch on public.calendar_appointments;
create trigger trg_calendar_appointments_touch
  before update on public.calendar_appointments
  for each row execute function public.fn_touch_updated_at();

drop trigger if exists trg_calendar_reminders_touch on public.calendar_reminders;
create trigger trg_calendar_reminders_touch
  before update on public.calendar_reminders
  for each row execute function public.fn_touch_updated_at();

alter table public.calendar_integrations enable row level security;
alter table public.calendar_appointments enable row level security;
alter table public.calendar_reminders enable row level security;

drop policy if exists calendar_integrations_select on public.calendar_integrations;
create policy calendar_integrations_select on public.calendar_integrations
  for select using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());
drop policy if exists calendar_integrations_write on public.calendar_integrations;
create policy calendar_integrations_write on public.calendar_integrations
  for all using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  ) with check (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists calendar_appointments_select on public.calendar_appointments;
create policy calendar_appointments_select on public.calendar_appointments
  for select using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());
drop policy if exists calendar_appointments_write on public.calendar_appointments;
create policy calendar_appointments_write on public.calendar_appointments
  for all using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'agent'))
  ) with check (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'agent'))
  );

drop policy if exists calendar_reminders_select on public.calendar_reminders;
create policy calendar_reminders_select on public.calendar_reminders
  for select using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

create or replace function public.fn_claim_due_calendar_reminders(
  p_limit integer default 25,
  p_lease_seconds integer default 180
) returns setof public.calendar_reminders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with due as (
    select r.id
    from public.calendar_reminders r
    join public.calendar_appointments a on a.id = r.appointment_id
    where r.scheduled_for <= now()
      and a.status in ('scheduled','rescheduled')
      and r.attempts < 5
      and (
        r.status = 'pending'
        or (r.status in ('processing','failed') and coalesce(r.claimed_until, '-infinity'::timestamptz) < now())
      )
    order by r.scheduled_for, r.id
    for update of r skip locked
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  )
  update public.calendar_reminders r
  set status = 'processing',
      claimed_at = now(),
      claimed_until = now() + make_interval(secs => greatest(30, coalesce(p_lease_seconds, 180))),
      attempts = r.attempts + 1,
      updated_at = now()
  from due
  where r.id = due.id
  returning r.*;
end;
$$;

revoke all on function public.fn_claim_due_calendar_reminders(integer, integer) from public, anon, authenticated;
grant execute on function public.fn_claim_due_calendar_reminders(integer, integer) to service_role;

grant select, insert, update, delete on public.calendar_integrations to authenticated;
grant select, insert, update, delete on public.calendar_appointments to authenticated;
grant select on public.calendar_reminders to authenticated;
grant all on public.calendar_integrations, public.calendar_appointments, public.calendar_reminders to service_role;

comment on table public.calendar_reminders is
  'Lembretes determinísticos de compromissos. message_body é um snapshot fixo e nunca é escrito pela IA.';
