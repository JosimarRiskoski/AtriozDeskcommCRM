-- 0107 — previsão e distribuição segura de campanhas entre conexões.
-- Preparada para aplicação posterior; não executada durante as fases.

alter table public.outreach_campaigns
  add column if not exists distribution_mode text not null default 'single',
  add column if not exists selected_channel_session_ids uuid[] not null default '{}',
  add column if not exists pipeline_id uuid references public.crm_pipelines(id) on delete set null,
  add column if not exists stage_id uuid references public.crm_stages(id) on delete set null,
  add column if not exists estimated_started_at timestamptz,
  add column if not exists estimated_completed_at timestamptz,
  add column if not exists estimated_duration_seconds integer,
  add column if not exists eligible_count integer not null default 0;

update public.outreach_campaigns set selected_channel_session_ids=array[channel_session_id]
where cardinality(selected_channel_session_ids)=0;

do $$ begin alter table public.outreach_campaigns add constraint outreach_campaigns_distribution_mode_check check (distribution_mode in ('single','balanced')); exception when duplicate_object then null; end $$;

with defaults as (
  select distinct on (p.organization_id)
    p.organization_id,
    p.id as pipeline_id,
    s.id as stage_id
  from public.crm_pipelines p
  join public.crm_stages s on s.pipeline_id=p.id and s.is_archived=false
  where p.is_archived=false
  order by p.organization_id, p.is_default desc, p.position, p.created_at, s.position, s.created_at
)
update public.outreach_campaigns c
set pipeline_id=coalesce(c.pipeline_id,d.pipeline_id),
    stage_id=coalesce(c.stage_id,d.stage_id)
from defaults d
where c.organization_id=d.organization_id
  and c.create_lead_before_send=true
  and (c.pipeline_id is null or c.stage_id is null);

do $$ begin alter table public.outreach_campaigns add constraint outreach_campaigns_opportunity_config_check check (not create_lead_before_send or (pipeline_id is not null and stage_id is not null)) not valid; exception when duplicate_object then null; end $$;

alter table public.outreach_campaign_recipients
  add column if not exists channel_session_id uuid references public.channel_sessions(id) on delete restrict,
  add column if not exists connection_position integer,
  add column if not exists assigned_at timestamptz,
  add column if not exists reassigned_at timestamptz,
  add column if not exists reassigned_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists assignment_reason text;

update public.outreach_campaign_recipients r set channel_session_id=c.channel_session_id,assigned_at=coalesce(r.created_at,now())
from public.outreach_campaigns c where c.id=r.campaign_id and r.channel_session_id is null;

create index if not exists idx_outreach_recipients_connection_queue on public.outreach_campaign_recipients(campaign_id,channel_session_id,connection_position) where status='pending';

create table if not exists public.outreach_campaign_connection_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  recipient_id uuid references public.outreach_campaign_recipients(id) on delete cascade,
  from_channel_session_id uuid references public.channel_sessions(id) on delete set null,
  to_channel_session_id uuid references public.channel_sessions(id) on delete set null,
  kind text not null check (kind in ('assigned','connection_paused','reassigned')),
  reason text not null, actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.outreach_campaign_connection_events enable row level security;
drop policy if exists outreach_campaign_connection_events_read on public.outreach_campaign_connection_events;
create policy outreach_campaign_connection_events_read on public.outreach_campaign_connection_events for select using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists outreach_campaign_connection_events_insert on public.outreach_campaign_connection_events;
create policy outreach_campaign_connection_events_insert on public.outreach_campaign_connection_events for insert with check (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id,'manager'));

-- A fila ignora destinatários cuja conexão atribuída esteja indisponível. Eles
-- continuam pendentes e somente voltam a ser elegíveis quando a conexão
-- recuperar ou um gestor confirmar uma reatribuição.
create or replace function public.fn_claim_due_outreach_recipient(p_lease_seconds integer default 180)
returns table (
  recipient_id uuid, campaign_id uuid, organization_id uuid, conversation_id uuid,
  created_by_user_id uuid, recipient_name text, phone_normalized text,
  text_template text, audio_storage_path text, delay_before_audio_seconds integer,
  interval_seconds integer, campaign_timezone text, business_hour_start time,
  business_hour_end time, text_sent_at timestamptz, audio_sent_at timestamptz
)
language plpgsql security definer set search_path=public as $$
declare v_recipient public.outreach_campaign_recipients%rowtype;
begin
  select r.* into v_recipient
    from public.outreach_campaign_recipients r
    join public.outreach_campaigns c on c.id=r.campaign_id
    join public.channel_sessions s on s.id=r.channel_session_id and s.organization_id=r.organization_id
   where c.status in ('scheduled','running') and s.status='WORKING'
     and coalesce(c.scheduled_for,now())<=now() and coalesce(c.next_dispatch_at,now())<=now()
     and r.consent_confirmed=true and r.conversation_id is not null
     and (r.status='pending' or (r.status='processing' and coalesce(r.processing_lease_until,'-infinity'::timestamptz)<now()))
   order by coalesce(c.next_dispatch_at,c.scheduled_for,c.created_at),r.position
   for update of r skip locked limit 1;
  if v_recipient.id is null then return; end if;
  update public.outreach_campaign_recipients set status='processing',claimed_at=now(),
    processing_lease_until=now()+make_interval(secs=>greatest(30,least(p_lease_seconds,900))),
    attempts=attempts+1,updated_at=now() where id=v_recipient.id;
  update public.outreach_campaigns set status='running',started_at=coalesce(started_at,now()),updated_at=now()
    where id=v_recipient.campaign_id;
  return query select r.id,c.id,c.organization_id,r.conversation_id,c.created_by_user_id,
    r.name,r.phone_normalized,c.text_template,c.audio_storage_path,c.delay_before_audio_seconds,
    c.interval_seconds,c.timezone,c.business_hour_start,c.business_hour_end,r.text_sent_at,r.audio_sent_at
    from public.outreach_campaign_recipients r join public.outreach_campaigns c on c.id=r.campaign_id
    where r.id=v_recipient.id;
end $$;
revoke all on function public.fn_claim_due_outreach_recipient(integer) from public,anon,authenticated;
grant execute on function public.fn_claim_due_outreach_recipient(integer) to service_role;
