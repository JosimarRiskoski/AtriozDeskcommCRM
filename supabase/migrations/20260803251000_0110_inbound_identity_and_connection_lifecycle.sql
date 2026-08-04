-- 0110_inbound_identity_and_connection_lifecycle
-- Fecha duas lacunas das Fases 0 e 1:
-- 1) preserva mensagens @lid ainda sem telefone, sem criar contato comercial incompleto;
-- 2) adiciona identidade, finalidade, padrão e arquivamento às conexões.

alter table public.channel_sessions
  add column if not exists purpose text,
  add column if not exists is_default boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists archive_reason text;

update public.channel_sessions
set display_name = 'WhatsApp ' || right(coalesce(phone_number, waha_session_name), 4)
where display_name is null or btrim(display_name) = '';

alter table public.channel_sessions alter column display_name set not null;

create unique index if not exists uniq_channel_sessions_default_per_org
  on public.channel_sessions (organization_id)
  where is_default = true and archived_at is null;

update public.channel_sessions s
set is_default = true
where s.archived_at is null
  and s.id = (
    select s2.id
    from public.channel_sessions s2
    where s2.organization_id = s.organization_id and s2.archived_at is null
    order by (s2.status = 'WORKING') desc, s2.created_at, s2.id
    limit 1
  )
  and not exists (
    select 1 from public.channel_sessions d
    where d.organization_id = s.organization_id
      and d.is_default = true
      and d.archived_at is null
  );

create table if not exists public.whatsapp_inbound_pending (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_session_id uuid not null references public.channel_sessions(id) on delete cascade,
  external_id text not null,
  chat_id text not null,
  lid text not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'reconciling', 'reconciled', 'failed')),
  attempts integer not null default 0,
  last_error text,
  reconciled_contact_id uuid references public.contacts(id) on delete set null,
  reconciled_conversation_id uuid references public.conversations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reconciled_at timestamptz,
  unique (organization_id, channel_session_id, external_id)
);

create index if not exists idx_whatsapp_inbound_pending_reconcile
  on public.whatsapp_inbound_pending (organization_id, channel_session_id, lid, created_at)
  where status in ('pending', 'failed');

alter table public.whatsapp_inbound_pending enable row level security;

drop policy if exists whatsapp_inbound_pending_select_manager on public.whatsapp_inbound_pending;
create policy whatsapp_inbound_pending_select_manager
  on public.whatsapp_inbound_pending for select to authenticated
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'manager')
  );

revoke all on public.whatsapp_inbound_pending from anon;
grant select on public.whatsapp_inbound_pending to authenticated;
grant all on public.whatsapp_inbound_pending to service_role;

comment on table public.whatsapp_inbound_pending is
  'Mensagens WhatsApp preservadas enquanto um @lid ainda nao pode ser ligado com seguranca a um telefone/contato.';

create or replace function public.fn_mark_incomplete_whatsapp_contact()
returns trigger language plpgsql set search_path=public as $$
begin
  if nullif(btrim(coalesce(new.display_name,'')),'') is null then
    new.display_name := coalesce(
      nullif(btrim(coalesce(new.name,'')),''),
      nullif(btrim(coalesce(new.email,'')),''),
      case when new.phone_number is not null
        then 'Contato ' || right(regexp_replace(new.phone_number,'\D','','g'),4)
        else null end,
      'Contato sem nome'
    );
  end if;

  if new.source='whatsapp' and new.phone_number is not null
     and nullif(btrim(coalesce(new.name,'')),'') is null
     and new.display_name ~ '^Contato [0-9]{4}$' then
    new.display_name := 'Contato ' || right(regexp_replace(new.phone_number,'\D','','g'),4);
    new.source_metadata := coalesce(new.source_metadata,'{}'::jsonb)
      || jsonb_build_object('cadastro_incompleto',true,'cadastro_incompleto_motivo','nome_nao_fornecido');
  elsif coalesce(new.display_name,new.name) is not null
        and coalesce(new.display_name,new.name) !~ '^Contato [0-9]{4}$' then
    new.source_metadata := coalesce(new.source_metadata,'{}'::jsonb) - 'cadastro_incompleto' - 'cadastro_incompleto_motivo';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mark_incomplete_whatsapp_contact on public.contacts;
create trigger trg_mark_incomplete_whatsapp_contact
before insert or update of phone_number,display_name,name,source_metadata on public.contacts
for each row execute function public.fn_mark_incomplete_whatsapp_contact();
