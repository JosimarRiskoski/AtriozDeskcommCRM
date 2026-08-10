-- 0124 — Evolution como único transporte WhatsApp.
--
-- `external_session_name` já foi preenchida e tornada NOT NULL pela 0114.
-- A coluna antiga obrigava toda criação Evolution a duplicar o mesmo nome em
-- um campo de outro provedor. Removê-la evita que o CRM continue dependendo
-- operacionalmente de um contrato encerrado.

update public.channel_sessions
set archived_at = coalesce(archived_at, now()),
    status_reason = coalesce(status_reason, 'Conexão legada encerrada na migração para Evolution')
where provider <> 'evolution';

update public.channel_sessions
set provider = 'evolution'
where provider <> 'evolution';

alter table public.channel_sessions
  alter column provider set default 'evolution';

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_check
  check (provider = 'evolution');

alter table public.channel_sessions
  drop column if exists waha_session_name;

comment on column public.channel_sessions.provider is
  'Transporte WhatsApp da conexão. O CRM opera exclusivamente com Evolution.';

-- Neutraliza também os nomes de metadados de identidade. Os valores continuam
-- os mesmos; apenas deixam de carregar o nome do provedor removido.
drop index if exists public.uniq_contacts_org_wa_identity;

alter table public.contacts drop column if exists wa_identity;

update public.contacts
set source_metadata =
      (coalesce(source_metadata, '{}'::jsonb) - 'waha_lid' - 'waha_chat_id')
      || jsonb_strip_nulls(jsonb_build_object(
           'whatsapp_lid', source_metadata ->> 'waha_lid',
           'whatsapp_chat_id', source_metadata ->> 'waha_chat_id'
         ))
where coalesce(source_metadata, '{}'::jsonb) ?| array['waha_lid', 'waha_chat_id'];

alter table public.contacts
  add column wa_identity text
  generated always as (
    case
      when phone_number is not null then 'phone:' || phone_number
      when source_metadata ->> 'whatsapp_lid' is not null
        then 'lid:' || regexp_replace(source_metadata ->> 'whatsapp_lid', '@.*$', '')
      else null
    end
  ) stored;

create unique index uniq_contacts_org_wa_identity
  on public.contacts (organization_id, wa_identity)
  where wa_identity is not null and is_merged_into is null;

create or replace function public.fn_upsert_wa_contact(
  p_org uuid,
  p_kind text,
  p_phone text,
  p_lid text,
  p_chat_id text,
  p_notify text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_phone_id uuid;
  v_lid_id uuid;
  v_notify text := nullif(btrim(coalesce(p_notify, '')), '');
  v_provider_metadata jsonb := jsonb_strip_nulls(jsonb_build_object(
    'whatsapp_lid', p_lid,
    'whatsapp_chat_id', p_chat_id,
    'notify_name', v_notify
  ));
begin
  if p_kind = 'resolved' and p_phone is not null and p_lid is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(p_org::text || ':lid:' || p_lid || ':phone:' || p_phone, 0)
    );

    select id into v_phone_id
      from public.contacts
     where organization_id = p_org
       and wa_identity = 'phone:' || p_phone
       and is_merged_into is null
     order by created_at, id
     limit 1;

    select id into v_lid_id
      from public.contacts
     where organization_id = p_org
       and wa_identity = 'lid:' || p_lid
       and is_merged_into is null
     order by created_at, id
     limit 1;

    if v_phone_id is not null then
      update public.contacts
         set display_name = case
               when v_notify is not null
                and (
                  nullif(btrim(coalesce(display_name, '')), '') is null
                  or display_name ~ '^Contato [0-9]{4}$'
                  or display_name = 'Contato sem nome'
                ) then v_notify
               else display_name
             end,
             source_metadata = coalesce(source_metadata, '{}'::jsonb) || v_provider_metadata,
             updated_at = now()
       where id = v_phone_id;
      return v_phone_id;
    end if;

    if v_lid_id is not null then
      update public.contacts
         set phone_number = p_phone,
             display_name = case
               when v_notify is not null
                and (
                  nullif(btrim(coalesce(display_name, '')), '') is null
                  or display_name ~ '^Contato [0-9]{4}$'
                  or display_name = 'Contato sem nome'
                ) then v_notify
               else display_name
             end,
             source_metadata = coalesce(source_metadata, '{}'::jsonb) || v_provider_metadata,
             updated_at = now()
       where id = v_lid_id
       returning id into v_id;
      return v_id;
    end if;
  end if;

  insert into public.contacts (
    organization_id, phone_number, source, consent, tags, source_metadata, display_name
  ) values (
    p_org,
    case when p_kind in ('phone', 'resolved') then p_phone end,
    'whatsapp',
    '{}'::jsonb,
    '{}'::text[],
    v_provider_metadata,
    v_notify
  )
  on conflict (organization_id, wa_identity)
    where wa_identity is not null and is_merged_into is null
  do update set
    display_name = case
      when excluded.display_name is not null
       and (
         nullif(btrim(coalesce(contacts.display_name, '')), '') is null
         or contacts.display_name ~ '^Contato [0-9]{4}$'
         or contacts.display_name = 'Contato sem nome'
       ) then excluded.display_name
      else contacts.display_name
    end,
    source_metadata = coalesce(contacts.source_metadata, '{}'::jsonb) || excluded.source_metadata,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.fn_upsert_wa_contact is
  'Resolve ou cria contato WhatsApp pela identidade recebida da Evolution e preserva nomes reais.';

revoke all on function public.fn_upsert_wa_contact(uuid, text, text, text, text, text) from public;
revoke execute on function public.fn_upsert_wa_contact(uuid, text, text, text, text, text) from anon;
grant execute on function public.fn_upsert_wa_contact(uuid, text, text, text, text, text) to service_role;
