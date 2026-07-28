-- 0088 — Meta Conversions API assíncrona e idempotente.
create table if not exists public.meta_capi_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  dataset_id text not null,
  access_token_encrypted text not null,
  graph_api_version text not null default 'v25.0' check (graph_api_version ~ '^v[0-9]+\.[0-9]+$'),
  event_name text not null default 'Purchase',
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  test_event_code text,
  require_consent boolean not null default true,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.meta_conversion_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  event_name text not null,
  event_id text not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  response_json jsonb,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, event_id)
);
create index if not exists idx_meta_conversion_due on public.meta_conversion_events(next_attempt_at) where status in ('pending','processing');

create or replace function public.fn_enqueue_meta_conversion_on_won() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_event_name text;
begin
  if new.status = 'won' and old.status is distinct from 'won' then
    select event_name into v_event_name from public.meta_capi_settings where organization_id=new.organization_id and enabled=true;
    if v_event_name is not null then
      insert into public.meta_conversion_events(organization_id,lead_id,event_name,event_id)
      values(new.organization_id,new.id,v_event_name,'lead-won-'||new.id::text)
      on conflict (organization_id,event_id) do nothing;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_enqueue_meta_conversion_on_won on public.crm_leads;
-- Sem `UPDATE OF status`: o fechamento normal atualiza stage_id e outro trigger
-- deriva status='won'; UPDATE OF olharia apenas a lista SET original e perderia o evento.
create trigger trg_enqueue_meta_conversion_on_won after update on public.crm_leads
for each row execute function public.fn_enqueue_meta_conversion_on_won();

create or replace function public.fn_claim_meta_conversion()
returns setof public.meta_conversion_events language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  select id into v_id from public.meta_conversion_events
   where status in ('pending','processing') and next_attempt_at<=now()
     and (status='pending' or coalesce(lease_until,'-infinity'::timestamptz)<now())
   order by next_attempt_at,created_at for update skip locked limit 1;
  if v_id is null then return; end if;
  return query update public.meta_conversion_events set status='processing',attempts=attempts+1,
    lease_until=now()+interval '3 minutes',updated_at=now() where id=v_id returning *;
end $$;
revoke all on function public.fn_claim_meta_conversion() from public,anon,authenticated;
grant execute on function public.fn_claim_meta_conversion() to service_role;

alter table public.meta_capi_settings enable row level security;
alter table public.meta_conversion_events enable row level security;
create policy meta_settings_manager on public.meta_capi_settings for all using (exists(select 1 from public.user_organizations u where u.organization_id=meta_capi_settings.organization_id and u.user_id=auth.uid() and u.revoked_at is null and u.role in ('manager','admin'))) with check (exists(select 1 from public.user_organizations u where u.organization_id=meta_capi_settings.organization_id and u.user_id=auth.uid() and u.revoked_at is null and u.role in ('manager','admin')));
create policy meta_events_read on public.meta_conversion_events for select using (exists(select 1 from public.user_organizations u where u.organization_id=meta_conversion_events.organization_id and u.user_id=auth.uid() and u.revoked_at is null));
