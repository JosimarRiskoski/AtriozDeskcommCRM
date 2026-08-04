-- Histórico imutável de origens do contato. Aplicar somente na etapa final de banco.
create table if not exists public.contact_source_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  source text not null,
  campaign_id uuid null,
  integration text null,
  channel_session_id uuid null references public.channel_sessions(id) on delete set null,
  external_id text null,
  tracking jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  actor_user_id uuid null references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_contact_source_events_contact_time
  on public.contact_source_events (organization_id, contact_id, occurred_at desc);
create index if not exists idx_contact_source_events_source_time
  on public.contact_source_events (organization_id, source, occurred_at desc);

alter table public.contact_source_events enable row level security;

drop policy if exists contact_source_events_select on public.contact_source_events;
create policy contact_source_events_select on public.contact_source_events
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

drop policy if exists contact_source_events_insert on public.contact_source_events;
create policy contact_source_events_insert on public.contact_source_events
  for insert to authenticated
  with check (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

create or replace function public.fn_contact_source_event_from_contact()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_meta jsonb := coalesce(new.source_metadata, '{}'::jsonb);
begin
  if tg_op = 'INSERT'
     or new.source is distinct from old.source
     or new.source_metadata is distinct from old.source_metadata then
    insert into public.contact_source_events (
      organization_id, contact_id, source, campaign_id, integration,
      channel_session_id, external_id, tracking, metadata, actor_user_id, occurred_at
    ) values (
      new.organization_id,
      new.id,
      coalesce(nullif(new.source, ''), 'desconhecida'),
      case when coalesce(v_meta->>'campaign_id', '') ~* '^[0-9a-f-]{36}$'
        then (v_meta->>'campaign_id')::uuid else null end,
      nullif(coalesce(v_meta->>'integration', v_meta->>'provider'), ''),
      case when coalesce(v_meta->>'channel_session_id', '') ~* '^[0-9a-f-]{36}$'
        then (v_meta->>'channel_session_id')::uuid else null end,
      nullif(coalesce(v_meta->>'external_id', v_meta->>'source_external_id'), ''),
      jsonb_strip_nulls(jsonb_build_object(
        'utm_source', v_meta->'utm_source',
        'utm_medium', v_meta->'utm_medium',
        'utm_campaign', v_meta->'utm_campaign',
        'utm_content', v_meta->'utm_content',
        'ad_id', v_meta->'ad_id'
      )),
      v_meta,
      auth.uid(),
      coalesce(new.updated_at, new.created_at, now())
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contact_source_event on public.contacts;
create trigger trg_contact_source_event
  after insert or update of source, source_metadata on public.contacts
  for each row execute function public.fn_contact_source_event_from_contact();

insert into public.contact_source_events (
  organization_id, contact_id, source, integration, external_id, tracking,
  metadata, actor_user_id, occurred_at
)
select
  c.organization_id,
  c.id,
  coalesce(nullif(c.source, ''), 'desconhecida'),
  nullif(coalesce(c.source_metadata->>'integration', c.source_metadata->>'provider'), ''),
  nullif(coalesce(c.source_metadata->>'external_id', c.source_metadata->>'source_external_id'), ''),
  jsonb_strip_nulls(jsonb_build_object(
    'utm_source', c.source_metadata->'utm_source',
    'utm_medium', c.source_metadata->'utm_medium',
    'utm_campaign', c.source_metadata->'utm_campaign',
    'utm_content', c.source_metadata->'utm_content',
    'ad_id', c.source_metadata->'ad_id'
  )),
  coalesce(c.source_metadata, '{}'::jsonb),
  c.created_by_user_id,
  c.created_at
from public.contacts c
where not exists (
  select 1 from public.contact_source_events e where e.contact_id = c.id
);

create or replace function public.fn_reject_contact_source_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'O histórico de origens é imutável';
end;
$$;

drop trigger if exists trg_contact_source_events_immutable on public.contact_source_events;
create trigger trg_contact_source_events_immutable
  before update or delete on public.contact_source_events
  for each row execute function public.fn_reject_contact_source_event_mutation();

