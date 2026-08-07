-- 0120_upgrade_provisional_whatsapp_names
-- Permite enriquecer automaticamente somente nomes provisórios criados quando
-- o primeiro evento do WhatsApp chega sem pushName. Nomes reais ou editados
-- manualmente continuam protegidos contra sobrescrita pelo provedor.

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
             source_metadata = coalesce(source_metadata, '{}'::jsonb)
               || jsonb_build_object('waha_lid', p_lid, 'waha_chat_id', p_chat_id)
               || case when v_notify is not null
                    then jsonb_build_object('notify_name', v_notify)
                    else '{}'::jsonb end,
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
             source_metadata = coalesce(source_metadata, '{}'::jsonb)
               || jsonb_build_object('waha_lid', p_lid, 'waha_chat_id', p_chat_id)
               || case when v_notify is not null
                    then jsonb_build_object('notify_name', v_notify)
                    else '{}'::jsonb end,
             updated_at = now()
       where id = v_lid_id
       returning id into v_id;
      return v_id;
    end if;

    insert into public.contacts (
      organization_id, phone_number, source, consent, tags, source_metadata, display_name
    ) values (
      p_org, p_phone, 'whatsapp', '{}'::jsonb, '{}'::text[],
      jsonb_build_object(
        'waha_lid', p_lid,
        'waha_chat_id', p_chat_id,
        'notify_name', v_notify
      ),
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
      source_metadata = coalesce(contacts.source_metadata, '{}'::jsonb)
        || excluded.source_metadata,
      updated_at = now()
    returning id into v_id;
    return v_id;
  end if;

  insert into public.contacts (
    organization_id, phone_number, source, consent, tags, source_metadata, display_name
  ) values (
    p_org,
    case when p_kind = 'phone' then p_phone end,
    'whatsapp',
    '{}'::jsonb,
    '{}'::text[],
    case when p_kind = 'lid'
      then jsonb_build_object('waha_lid', p_lid, 'notify_name', v_notify)
      else jsonb_build_object('waha_chat_id', p_chat_id, 'notify_name', v_notify) end,
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
    source_metadata = coalesce(contacts.source_metadata, '{}'::jsonb)
      || excluded.source_metadata,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.fn_upsert_wa_contact is
  'Resolve/cria contato WhatsApp e substitui apenas nomes provisórios quando o provedor entrega um nome real.';

revoke all on function public.fn_upsert_wa_contact(uuid, text, text, text, text, text) from public;
revoke execute on function public.fn_upsert_wa_contact(uuid, text, text, text, text, text) from anon;
grant execute on function public.fn_upsert_wa_contact(uuid, text, text, text, text, text) to service_role;

-- Corrige imediatamente cadastros provisórios quando algum evento anterior já
-- deixou um notify_name válido nos metadados. Quando o provedor nunca enviou o
-- nome, o cadastro continua incompleto e pode ser editado manualmente.
update public.contacts
set display_name = btrim(source_metadata ->> 'notify_name'),
    updated_at = now()
where display_name ~ '^Contato [0-9]{4}$'
  and nullif(btrim(coalesce(source_metadata ->> 'notify_name', '')), '') is not null
  and btrim(source_metadata ->> 'notify_name') !~ '^Contato [0-9]{4}$';
