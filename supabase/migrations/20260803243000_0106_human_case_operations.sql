-- 0106 — transforma agent_cases em uma fila operacional de atendimento humano.
-- Esta migration é preparada para aplicação posterior; não foi executada durante as fases.

alter table public.user_organizations
  add column if not exists can_receive_human_cases boolean not null default false,
  add column if not exists is_primary_human_case_responder boolean not null default false;

alter table public.team_invitations
  add column if not exists can_receive_human_cases boolean not null default false;

create unique index if not exists uq_primary_human_case_responder_per_org
  on public.user_organizations (organization_id)
  where is_primary_human_case_responder and revoked_at is null;

alter table public.agent_cases
  add column if not exists assignee_user_id uuid references auth.users(id) on delete set null,
  add column if not exists urgency text not null default 'normal',
  add column if not exists category text not null default 'other',
  add column if not exists reason_code text not null default 'manual',
  add column if not exists first_response_due_at timestamptz,
  add column if not exists first_alert_sent_at timestamptz,
  add column if not exists last_alert_at timestamptz,
  add column if not exists alert_repeat_count integer not null default 0,
  add column if not exists escalation_due_at timestamptz,
  add column if not exists escalated_at timestamptz,
  add column if not exists first_human_response_at timestamptz,
  add column if not exists resolution_note text,
  add column if not exists assigned_at timestamptz;

do $$ begin
  alter table public.agent_cases add constraint agent_cases_urgency_check
    check (urgency in ('low','normal','high','critical'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.agent_cases add constraint agent_cases_category_check
    check (category in ('customer_request','low_confidence','missing_information','repeated_failure',
      'complaint_or_risk','calculation','commercial_exception','document_review','tool_unavailable','crm_error','other'));
exception when duplicate_object then null; end $$;

create index if not exists idx_agent_cases_queue
  on public.agent_cases (organization_id,status,urgency,opened_at);
create index if not exists idx_agent_cases_assignee
  on public.agent_cases (organization_id,assignee_user_id,status);

alter table public.agent_case_events drop constraint if exists agent_case_events_kind_check;
alter table public.agent_case_events add constraint agent_case_events_kind_check check (kind in
  ('opened','assigned','transferred','human_replied','lead_asked','lead_provided',
   'lead_unresponsive','resolved','escalated','cancelled','continued_on_connection'));

create table if not exists public.human_support_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  first_alert_minutes integer not null default 5 check (first_alert_minutes between 1 and 1440),
  escalation_minutes integer not null default 30 check (escalation_minutes between 1 and 10080),
  repeat_alert_minutes integer not null default 30 check (repeat_alert_minutes between 5 and 10080),
  max_alert_repeats integer not null default 3 check (max_alert_repeats between 0 and 20),
  close_alert_on_resolution boolean not null default true,
  timezone text not null default 'America/Sao_Paulo',
  business_hours jsonb not null default '{"enabled":false,"windows":[]}'::jsonb,
  notify_in_app boolean not null default true,
  notify_email boolean not null default false,
  notify_whatsapp_group boolean not null default false,
  whatsapp_connection_id uuid references public.channel_sessions(id) on delete set null,
  whatsapp_group_chat_id text,
  whatsapp_group_name text,
  group_phone_display text not null default 'masked' check (group_phone_display in ('masked','full')),
  group_notify_handoffs boolean not null default true,
  group_notify_crm_errors boolean not null default true,
  group_notify_connection_down boolean not null default true,
  group_notify_ai_budget boolean not null default true,
  group_notify_campaign_paused boolean not null default true,
  allow_group_replies boolean not null default false,
  authorized_manager_phones text[] not null default '{}',
  group_message_template text not null default E'NOVO CASO HUMANO\nContato: {{contact_name}}\nTelefone: {{contact_phone}}\nResumo: {{summary}}\nUrgência: {{urgency}}\nResponsável: {{assignee_name}}\nAbrir no CRM: {{crm_link}}\nCaso: {{case_id}}',
  handoff_rules jsonb not null default '{"customer_request":true,"low_confidence":true,"missing_information":true,"repeated_failure":true,"complaint_or_risk":true,"calculation":true,"commercial_exception":true,"document_review":true,"tool_unavailable":true,"required_document_types":["documento pessoal","fatura de energia"],"custom_intents":[]}'::jsonb,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.human_support_settings enable row level security;
drop policy if exists human_support_settings_select on public.human_support_settings;
create policy human_support_settings_select on public.human_support_settings for select
  using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists human_support_settings_write on public.human_support_settings;
create policy human_support_settings_write on public.human_support_settings for all
  using (public.fn_role_at_least(organization_id,'admin'))
  with check (public.fn_role_at_least(organization_id,'admin'));

create or replace function public.fn_agent_case_set_deadlines()
returns trigger language plpgsql set search_path=public as $$
declare v_settings public.human_support_settings%rowtype;
begin
  select * into v_settings from public.human_support_settings where organization_id=new.organization_id;
  if new.first_response_due_at is null then
    new.first_response_due_at := new.opened_at + make_interval(mins => coalesce(v_settings.first_alert_minutes,5));
  end if;
  if new.escalation_due_at is null then
    new.escalation_due_at := new.opened_at + make_interval(mins => coalesce(v_settings.escalation_minutes,30));
  end if;
  if new.assignee_user_id is null then
    select user_id into new.assignee_user_id from public.user_organizations
     where organization_id=new.organization_id and revoked_at is null and accepted_at is not null
       and can_receive_human_cases and is_primary_human_case_responder limit 1;
    if new.assignee_user_id is not null then new.assigned_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_agent_case_set_deadlines on public.agent_cases;
create trigger trg_agent_case_set_deadlines before insert on public.agent_cases
for each row execute function public.fn_agent_case_set_deadlines();

revoke execute on function public.fn_agent_case_set_deadlines() from public,anon,authenticated;

-- Categorias e fila durável para avisos no grupo de gestores.
alter table public.notification_events drop constraint if exists notification_events_category_check;
alter table public.notification_events add constraint notification_events_category_check check (category in (
  'lead_assigned','human_handoff','client_new','file_received','file_rejected',
  'whatsapp_disconnected','send_failed','ai_failure','ai_budget',
  'campaign_interrupted','team_invite_failed','lead_won','lead_lost','mention'
));

create table if not exists public.whatsapp_group_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.notification_events(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.channel_sessions(id) on delete cascade,
  group_chat_id text not null check (group_chat_id ~ '^\d+(-\d+)?@g\.us$'),
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','skipped')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id)
);
create index if not exists idx_whatsapp_group_delivery_due on public.whatsapp_group_notification_deliveries(next_attempt_at)
  where status in ('pending','failed');
alter table public.whatsapp_group_notification_deliveries enable row level security;
drop policy if exists whatsapp_group_delivery_admin_read on public.whatsapp_group_notification_deliveries;
create policy whatsapp_group_delivery_admin_read on public.whatsapp_group_notification_deliveries for select
  using (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id,'admin'));

create or replace function public.fn_human_support_group_fanout()
returns trigger language plpgsql security definer set search_path=public as $$
declare s public.human_support_settings%rowtype; v_enabled boolean;
begin
  select * into s from public.human_support_settings where organization_id=new.organization_id;
  if not found or not s.notify_whatsapp_group or s.whatsapp_connection_id is null or s.whatsapp_group_chat_id is null then return new; end if;
  v_enabled := case new.category
    when 'human_handoff' then s.group_notify_handoffs
    when 'whatsapp_disconnected' then s.group_notify_connection_down
    when 'ai_budget' then s.group_notify_ai_budget
    when 'campaign_interrupted' then s.group_notify_campaign_paused
    when 'send_failed' then s.group_notify_crm_errors
    when 'ai_failure' then s.group_notify_crm_errors
    else false end;
  if v_enabled then
    insert into public.whatsapp_group_notification_deliveries(event_id,organization_id,connection_id,group_chat_id)
    values(new.id,new.organization_id,s.whatsapp_connection_id,s.whatsapp_group_chat_id) on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists trg_human_support_group_fanout on public.notification_events;
create trigger trg_human_support_group_fanout after insert on public.notification_events for each row execute function public.fn_human_support_group_fanout();

create or replace function public.fn_claim_whatsapp_group_deliveries(p_limit integer default 10)
returns setof public.whatsapp_group_notification_deliveries language plpgsql security definer set search_path=public as $$
begin
  return query with due as (
    select id from public.whatsapp_group_notification_deliveries
    where status in ('pending','failed') and next_attempt_at<=now() and (lease_until is null or lease_until<now()) and attempts<5
    order by next_attempt_at for update skip locked limit greatest(1,least(p_limit,25))
  ) update public.whatsapp_group_notification_deliveries d set status='processing',attempts=d.attempts+1,lease_until=now()+interval '5 minutes',updated_at=now()
  from due where d.id=due.id returning d.*;
end $$;
revoke all on function public.fn_claim_whatsapp_group_deliveries(integer) from public,anon,authenticated;
grant execute on function public.fn_claim_whatsapp_group_deliveries(integer) to service_role;

create or replace function public.fn_notify_human_case_opened()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.fn_emit_notification(new.organization_id,'human_handoff',
    case when new.urgency='critical' then 'critical' else 'warning' end,
    'Novo caso humano: '||new.title,new.summary,'/app/ai/cases','agent_case',new.id,
    'human-case-'||new.id,new.assignee_user_id,
    jsonb_build_object('case_id',new.id,'urgency',new.urgency,'conversation_id',new.conversation_id));
  return new;
end $$;
drop trigger if exists trg_notify_human_case_opened on public.agent_cases;
create trigger trg_notify_human_case_opened after insert on public.agent_cases for each row execute function public.fn_notify_human_case_opened();

create or replace function public.fn_notify_ai_budget_item()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.kind='budget_exceeded' and new.organization_id is not null then
    perform public.fn_emit_notification(new.organization_id,'ai_budget','critical',new.title,coalesce(new.body,''),
      '/app/ai/inbox','agent_inbox_item',new.id,'ai-budget-'||new.id,null,jsonb_build_object('ref_kind',new.ref_kind,'ref_id',new.ref_id));
  end if;
  return new;
end $$;
drop trigger if exists trg_notify_ai_budget_item on public.agent_inbox_items;
create trigger trg_notify_ai_budget_item after insert on public.agent_inbox_items for each row execute function public.fn_notify_ai_budget_item();

revoke execute on function public.fn_human_support_group_fanout() from public,anon,authenticated;
revoke execute on function public.fn_notify_human_case_opened() from public,anon,authenticated;
revoke execute on function public.fn_notify_ai_budget_item() from public,anon,authenticated;

create or replace function public.fn_human_support_notifications_open(p_org uuid)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare s public.human_support_settings%rowtype;
begin
  select * into s from public.human_support_settings where organization_id=p_org;
  if not found or coalesce((s.business_hours->>'enabled')::boolean,false)=false then return true; end if;
  return exists (
    select 1 from jsonb_array_elements(coalesce(s.business_hours->'windows','[]'::jsonb)) w
    where (w->>'dow')::int = extract(dow from now() at time zone s.timezone)::int
      and (now() at time zone s.timezone)::time >= (w->>'start')::time
      and (now() at time zone s.timezone)::time < (w->>'end')::time
  );
end;
$$;

create or replace function public.fn_process_human_case_deadlines()
returns jsonb language plpgsql security definer set search_path=public as $$
declare c record; v_alerts int:=0; v_escalations int:=0;
begin
  for c in update public.agent_cases set first_alert_sent_at=now(),last_alert_at=now(),alert_repeat_count=1,updated_at=now()
    where status='awaiting_human' and first_alert_sent_at is null and first_response_due_at<=now()
      and public.fn_human_support_notifications_open(organization_id)
    returning * loop
    perform public.fn_emit_notification(c.organization_id,'human_handoff','warning','Caso humano aguardando resposta',c.title,
      '/app/ai/cases','agent_case',c.id,'human-case-first-alert-'||c.id,c.assignee_user_id,
      jsonb_build_object('case_id',c.id,'urgency',c.urgency,'deadline','first_alert'));
    v_alerts:=v_alerts+1;
  end loop;
  for c in select ac.*,hs.repeat_alert_minutes,hs.max_alert_repeats from public.agent_cases ac
    join public.human_support_settings hs on hs.organization_id=ac.organization_id
    where ac.status in ('awaiting_human','escalated') and ac.first_alert_sent_at is not null
      and ac.alert_repeat_count < hs.max_alert_repeats
      and ac.last_alert_at + make_interval(mins=>hs.repeat_alert_minutes)<=now()
      and public.fn_human_support_notifications_open(ac.organization_id) loop
    update public.agent_cases set last_alert_at=now(),alert_repeat_count=alert_repeat_count+1,updated_at=now() where id=c.id;
    perform public.fn_emit_notification(c.organization_id,'human_handoff',case when c.status='escalated' then 'critical' else 'warning' end,
      'Lembrete: caso humano ainda aberto',c.title,'/app/ai/cases','agent_case',c.id,
      'human-case-repeat-'||c.id||'-'||(c.alert_repeat_count+1),c.assignee_user_id,
      jsonb_build_object('case_id',c.id,'urgency',c.urgency,'repeat',c.alert_repeat_count+1));
    v_alerts:=v_alerts+1;
  end loop;
  for c in update public.agent_cases set status='escalated',escalated_at=now(),updated_at=now()
    where status='awaiting_human' and escalation_due_at<=now()
      and public.fn_human_support_notifications_open(organization_id)
    returning * loop
    insert into public.agent_case_events(organization_id,case_id,kind,actor_kind,body,metadata)
    values(c.organization_id,c.id,'escalated','system','Prazo de atendimento excedido',jsonb_build_object('deadline','escalation'));
    perform public.fn_emit_notification(c.organization_id,'human_handoff','critical','Caso humano escalado por atraso',c.title,
      '/app/ai/cases','agent_case',c.id,'human-case-escalated-'||c.id,null,
      jsonb_build_object('case_id',c.id,'urgency',c.urgency,'deadline','escalation'));
    v_escalations:=v_escalations+1;
  end loop;
  return jsonb_build_object('alerts',v_alerts,'escalations',v_escalations);
end $$;
revoke all on function public.fn_process_human_case_deadlines() from public,anon,authenticated;
grant execute on function public.fn_process_human_case_deadlines() to service_role;
revoke all on function public.fn_human_support_notifications_open(uuid) from public,anon,authenticated;
grant execute on function public.fn_human_support_notifications_open(uuid) to service_role;

create or replace function public.fn_close_human_case_alerts()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status in ('resolved','cancelled') and old.status is distinct from new.status
     and coalesce((select close_alert_on_resolution from public.human_support_settings where organization_id=new.organization_id),true) then
    update public.notification_events set resolved_at=coalesce(resolved_at,now())
      where organization_id=new.organization_id and resource_type='agent_case' and resource_id=new.id and resolved_at is null;
  end if;
  return new;
end $$;
drop trigger if exists trg_close_human_case_alerts on public.agent_cases;
create trigger trg_close_human_case_alerts after update of status on public.agent_cases for each row execute function public.fn_close_human_case_alerts();
revoke execute on function public.fn_close_human_case_alerts() from public,anon,authenticated;

create table if not exists public.conversation_continuations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  from_conversation_id uuid not null references public.conversations(id) on delete cascade,
  to_conversation_id uuid not null references public.conversations(id) on delete cascade,
  from_connection_id uuid not null references public.channel_sessions(id) on delete restrict,
  to_connection_id uuid not null references public.channel_sessions(id) on delete restrict,
  reason text not null,
  context_message text not null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(from_conversation_id,to_conversation_id)
);
alter table public.conversation_continuations enable row level security;
drop policy if exists conversation_continuations_select on public.conversation_continuations;
create policy conversation_continuations_select on public.conversation_continuations for select
  using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists conversation_continuations_insert on public.conversation_continuations;
create policy conversation_continuations_insert on public.conversation_continuations for insert
  with check (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id,'agent'));
