-- 0089 — central de notificações real: eventos, preferências, leitura e entrega.

create table if not exists public.notification_preferences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  channel text not null check (channel in ('in_app','email')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (organization_id,user_id,category,channel)
);

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  target_user_id uuid references auth.users(id) on delete cascade,
  category text not null check (category in (
    'lead_assigned','human_handoff','client_new','file_received','file_rejected',
    'whatsapp_disconnected','send_failed','ai_failure',
    'campaign_interrupted','team_invite_failed','lead_won','lead_lost','mention'
  )),
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  title text not null check (length(btrim(title)) between 1 and 160),
  body text not null default '' check (length(body) <= 2000),
  action_url text check (action_url is null or action_url ~ '^/app(/|$)'),
  resource_type text,
  resource_id uuid,
  dedupe_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index if not exists uq_notification_event_dedupe
  on public.notification_events(organization_id,dedupe_key)
  where dedupe_key is not null;
create index if not exists idx_notification_events_org_created
  on public.notification_events(organization_id,created_at desc);

create table if not exists public.notification_reads (
  event_id uuid not null references public.notification_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (event_id,user_id)
);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.notification_events(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel = 'email'),
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','skipped')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id,user_id,channel)
);
create index if not exists idx_notification_delivery_due
  on public.notification_deliveries(next_attempt_at)
  where status in ('pending','failed');

alter table public.notification_preferences enable row level security;
alter table public.notification_events enable row level security;
alter table public.notification_reads enable row level security;
alter table public.notification_deliveries enable row level security;

create policy notification_preferences_own on public.notification_preferences for all
  using (user_id=auth.uid() and organization_id in (select public.fn_user_org_ids()))
  with check (user_id=auth.uid() and organization_id in (select public.fn_user_org_ids()));
create policy notification_events_member_read on public.notification_events for select
  using (organization_id in (select public.fn_user_org_ids()) and (target_user_id is null or target_user_id=auth.uid()));
create policy notification_reads_own on public.notification_reads for all
  using (user_id=auth.uid() and event_id in (
    select id from public.notification_events
     where organization_id in (select public.fn_user_org_ids()) and (target_user_id is null or target_user_id=auth.uid())
  ))
  with check (user_id=auth.uid() and event_id in (
    select id from public.notification_events
     where organization_id in (select public.fn_user_org_ids()) and (target_user_id is null or target_user_id=auth.uid())
  ));
create policy notification_deliveries_admin_read on public.notification_deliveries for select
  using (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id,'admin'));

create or replace function public.fn_notification_fanout()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_member record; v_email_default boolean;
begin
  v_email_default := new.severity='critical' or new.category in ('human_handoff','whatsapp_disconnected','ai_failure');
  for v_member in
    select user_id from public.user_organizations
     where organization_id=new.organization_id and revoked_at is null and accepted_at is not null
       and (new.target_user_id is null or user_id=new.target_user_id)
  loop
    if coalesce((select enabled from public.notification_preferences
                  where organization_id=new.organization_id and user_id=v_member.user_id
                    and category=new.category and channel='email'),v_email_default) then
      insert into public.notification_deliveries(event_id,organization_id,user_id,channel)
      values(new.id,new.organization_id,v_member.user_id,'email') on conflict do nothing;
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists trg_notification_fanout on public.notification_events;
create trigger trg_notification_fanout after insert on public.notification_events
for each row execute function public.fn_notification_fanout();

create or replace function public.fn_emit_notification(
  p_org uuid,p_category text,p_severity text,p_title text,p_body text,
  p_action_url text default null,p_resource_type text default null,p_resource_id uuid default null,
  p_dedupe_key text default null,p_target_user uuid default null,p_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  insert into public.notification_events(
    organization_id,target_user_id,category,severity,title,body,action_url,
    resource_type,resource_id,dedupe_key,metadata
  ) values(
    p_org,p_target_user,p_category,p_severity,p_title,p_body,p_action_url,
    p_resource_type,p_resource_id,p_dedupe_key,coalesce(p_metadata,'{}'::jsonb)
  ) on conflict (organization_id,dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.fn_emit_notification(uuid,text,text,text,text,text,text,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fn_emit_notification(uuid,text,text,text,text,text,text,uuid,text,uuid,jsonb) to service_role;

create or replace function public.fn_claim_notification_deliveries(p_limit integer default 20)
returns setof public.notification_deliveries language plpgsql security definer set search_path=public as $$
begin
  return query
  with due as (
    select id from public.notification_deliveries
     where status in ('pending','failed') and next_attempt_at<=now()
       and (lease_until is null or lease_until<now()) and attempts<5
     order by next_attempt_at for update skip locked limit greatest(1,least(p_limit,50))
  )
  update public.notification_deliveries d set
    status='processing',attempts=d.attempts+1,lease_until=now()+interval '5 minutes',updated_at=now()
  from due where d.id=due.id returning d.*;
end $$;
revoke all on function public.fn_claim_notification_deliveries(integer) from public,anon,authenticated;
grant execute on function public.fn_claim_notification_deliveries(integer) to service_role;

create or replace function public.fn_notify_contact_created()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.fn_emit_notification(new.organization_id,'client_new','info','Novo cliente',
    coalesce(new.display_name,new.name,new.phone_number,'Novo contato cadastrado'),
    '/app/contacts/'||new.id,'contact',new.id,'contact-created-'||new.id);
  return new;
end $$;
drop trigger if exists trg_notify_contact_created on public.contacts;
create trigger trg_notify_contact_created after insert on public.contacts for each row execute function public.fn_notify_contact_created();

create or replace function public.fn_notify_conversation_handoff()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.last_handoff_at is distinct from old.last_handoff_at and new.last_handoff_at is not null then
    perform public.fn_emit_notification(new.organization_id,'human_handoff','critical','Cliente aguardando atendimento humano',
      coalesce(new.last_handoff_reason,'A IA solicitou ajuda de uma pessoa.'),
      '/app/inbox/'||new.id,'conversation',new.id,'handoff-'||new.id||'-'||extract(epoch from new.last_handoff_at)::bigint);
  end if; return new;
end $$;
drop trigger if exists trg_notify_conversation_handoff on public.conversations;
create trigger trg_notify_conversation_handoff after update on public.conversations
for each row execute function public.fn_notify_conversation_handoff();

create or replace function public.fn_notify_message_event()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.direction='inbound' and new.type in ('image','document','video','audio') and tg_op='INSERT' then
    perform public.fn_emit_notification(new.organization_id,'file_received','info','Arquivo recebido pelo WhatsApp',
      'O cliente enviou '||new.type||'.','/app/inbox/'||new.conversation_id,'message',new.id,'media-'||new.id);
  end if;
  if new.direction='outbound' and new.status='failed' and (tg_op='INSERT' or old.status is distinct from new.status) then
    perform public.fn_emit_notification(new.organization_id,'send_failed','critical','Falha ao enviar mensagem',
      coalesce(new.error_message,'A mensagem não chegou ao provedor.'),'/app/inbox/'||new.conversation_id,
      'message',new.id,'message-failed-'||new.id);
  end if; return new;
end $$;
drop trigger if exists trg_notify_message_insert on public.messages;
drop trigger if exists trg_notify_message_update on public.messages;
create trigger trg_notify_message_insert after insert on public.messages for each row execute function public.fn_notify_message_event();
create trigger trg_notify_message_update after update of status on public.messages for each row execute function public.fn_notify_message_event();

create or replace function public.fn_notify_channel_disconnected()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.status is distinct from new.status and lower(new.status) in ('failed','stopped','disconnected','error') then
    perform public.fn_emit_notification(new.organization_id,'whatsapp_disconnected','critical','WhatsApp desconectado',
      coalesce(new.status_reason,'A conexão precisa ser verificada.'),'/app/connections',
      'channel_session',new.id,'channel-down-'||new.id||'-'||extract(epoch from new.last_status_change_at)::bigint);
  end if; return new;
end $$;
drop trigger if exists trg_notify_channel_disconnected on public.channel_sessions;
create trigger trg_notify_channel_disconnected after update of status on public.channel_sessions
for each row execute function public.fn_notify_channel_disconnected();

create or replace function public.fn_notify_ai_failure()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='failed' and (tg_op='INSERT' or old.status is distinct from new.status) and not new.is_dry_run then
    perform public.fn_emit_notification(new.organization_id,'ai_failure','critical','Agente de IA não conseguiu responder',
      'Verifique crédito, credencial e provedor do agente.',
      case when new.conversation_id is null then '/app/ai/agents/'||new.agent_id else '/app/inbox/'||new.conversation_id end,
      'ai_agent_run',new.id,'ai-run-failed-'||new.id,null,jsonb_build_object('error_code',new.error_code));
  end if; return new;
end $$;
drop trigger if exists trg_notify_ai_run_insert on public.ai_agent_runs;
drop trigger if exists trg_notify_ai_run_update on public.ai_agent_runs;
create trigger trg_notify_ai_run_insert after insert on public.ai_agent_runs for each row execute function public.fn_notify_ai_failure();
create trigger trg_notify_ai_run_update after update of status on public.ai_agent_runs for each row execute function public.fn_notify_ai_failure();

create or replace function public.fn_notify_lead_result()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_category text; v_title text;
begin
  if old.status is distinct from new.status and new.status in ('won','lost') then
    v_category := case when new.status='won' then 'lead_won' else 'lead_lost' end;
    v_title := case when new.status='won' then 'Negócio ganho' else 'Negócio perdido' end;
    perform public.fn_emit_notification(new.organization_id,v_category,'info',v_title,new.title,
      '/app/pipelines/'||new.pipeline_id,'lead',new.id,'lead-result-'||new.id||'-'||new.status,new.owner_user_id);
  end if; return new;
end $$;
drop trigger if exists trg_notify_lead_result on public.crm_leads;
create trigger trg_notify_lead_result after update of status on public.crm_leads
for each row execute function public.fn_notify_lead_result();

create or replace function public.fn_notify_lead_assignment()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.owner_user_id is distinct from old.owner_user_id and new.owner_user_id is not null then
    perform public.fn_emit_notification(new.organization_id,'lead_assigned','info','Lead atribuído a você',new.title,
      '/app/pipelines/'||new.pipeline_id,'lead',new.id,
      'lead-assigned-'||new.id||'-'||new.owner_user_id,new.owner_user_id);
  end if; return new;
end $$;
drop trigger if exists trg_notify_lead_assignment on public.crm_leads;
create trigger trg_notify_lead_assignment after update of owner_user_id on public.crm_leads
for each row execute function public.fn_notify_lead_assignment();

create or replace function public.fn_notify_campaign_failure()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.status is distinct from new.status and new.status='failed' then
    perform public.fn_emit_notification(new.organization_id,'campaign_interrupted','warning','Destinatário interrompido na campanha',
      coalesce(new.last_error_message,'O envio excedeu o limite de tentativas.'),'/app/campaigns',
      'outreach_campaign',new.campaign_id,'campaign-recipient-failed-'||new.id);
  end if; return new;
end $$;
drop trigger if exists trg_notify_campaign_failure on public.outreach_campaign_recipients;
create trigger trg_notify_campaign_failure after update of status on public.outreach_campaign_recipients
for each row execute function public.fn_notify_campaign_failure();

revoke execute on function public.fn_notification_fanout() from public,anon,authenticated;
revoke execute on function public.fn_notify_contact_created() from public,anon,authenticated;
revoke execute on function public.fn_notify_conversation_handoff() from public,anon,authenticated;
revoke execute on function public.fn_notify_message_event() from public,anon,authenticated;
revoke execute on function public.fn_notify_channel_disconnected() from public,anon,authenticated;
revoke execute on function public.fn_notify_ai_failure() from public,anon,authenticated;
revoke execute on function public.fn_notify_lead_result() from public,anon,authenticated;
revoke execute on function public.fn_notify_lead_assignment() from public,anon,authenticated;
revoke execute on function public.fn_notify_campaign_failure() from public,anon,authenticated;
