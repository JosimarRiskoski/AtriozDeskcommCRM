-- Bloqueio central e histórico imutável. Aplicar somente na etapa final de banco.
create table if not exists public.contact_communication_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  action text not null check (action in ('blocked','reactivated')),
  reason text not null,
  source text not null,
  actor_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_contact_communication_events_contact
  on public.contact_communication_events (organization_id, contact_id, created_at desc);

alter table public.contact_communication_events enable row level security;
drop policy if exists contact_communication_events_select on public.contact_communication_events;
create policy contact_communication_events_select on public.contact_communication_events
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

create or replace function public.fn_set_contact_communication_status(
  p_contact uuid,
  p_blocked boolean,
  p_reason text,
  p_source text default 'manual'
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_contact public.contacts%rowtype;
  v_followups integer := 0;
  v_recipients integer := 0;
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Informe um motivo com pelo menos 3 caracteres';
  end if;

  select * into v_contact from public.contacts
  where id = p_contact for update;
  if v_contact.id is null
     or (v_contact.organization_id not in (select public.fn_user_org_ids())
         and not public.fn_is_platform_admin()
         and coalesce(auth.role(), '') <> 'service_role') then
    raise exception 'Contato nao encontrado';
  end if;
  if not public.fn_role_at_least(v_contact.organization_id, 'admin')
     and not public.fn_is_platform_admin()
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Permissao insuficiente';
  end if;

  if v_contact.is_blocked = p_blocked then
    return jsonb_build_object('changed', false, 'followups_cancelled', 0, 'recipients_cancelled', 0);
  end if;

  update public.contacts
  set is_blocked = p_blocked,
      blocked_reason = case when p_blocked then trim(p_reason) else null end,
      blocked_at = case when p_blocked then now() else null end,
      updated_at = now()
  where id = p_contact;

  insert into public.contact_communication_events (
    organization_id, contact_id, action, reason, source, actor_user_id
  ) values (
    v_contact.organization_id, p_contact,
    case when p_blocked then 'blocked' else 'reactivated' end,
    trim(p_reason), coalesce(nullif(trim(p_source), ''), 'manual'), auth.uid()
  );

  if p_blocked then
    update public.followup_enrollments
    set status = 'cancelled', next_eval_at = null, claimed_until = null,
        cancel_reason = 'contact_blocked', outcome = 'opted_out',
        completed_at = now(), updated_at = now()
    where organization_id = v_contact.organization_id
      and contact_id = p_contact
      and status in ('active','waiting_reply','paused_handoff');
    get diagnostics v_followups = row_count;

    update public.outreach_campaign_recipients
    set status = 'cancelled', scheduled_at = null,
        last_error_code = 'contact_blocked',
        last_error_message = 'Contato excluido ou com opt-out no CRM',
        updated_at = now()
    where organization_id = v_contact.organization_id
      and contact_id = p_contact
      and status in ('pending','processing');
    get diagnostics v_recipients = row_count;
  end if;

  return jsonb_build_object(
    'changed', true,
    'followups_cancelled', v_followups,
    'recipients_cancelled', v_recipients
  );
end;
$$;

revoke all on function public.fn_set_contact_communication_status(uuid,boolean,text,text)
  from public, anon;
grant execute on function public.fn_set_contact_communication_status(uuid,boolean,text,text)
  to authenticated, service_role;

create or replace function public.fn_reject_contact_communication_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'O histórico de comunicação é imutável';
end;
$$;

drop trigger if exists trg_contact_communication_events_immutable on public.contact_communication_events;
create trigger trg_contact_communication_events_immutable
  before update or delete on public.contact_communication_events
  for each row execute function public.fn_reject_contact_communication_event_mutation();
