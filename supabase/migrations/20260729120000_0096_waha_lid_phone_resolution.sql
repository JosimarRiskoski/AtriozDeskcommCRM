-- 0096_waha_lid_phone_resolution
-- Enriquece contatos recebidos como @lid com o telefone resolvido pelo WAHA.
-- A mesma RPC e assinatura sao preservadas para manter compatibilidade.

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
begin
  if p_kind = 'resolved' and p_phone is not null and p_lid is not null then
    -- Serializa a primeira mensagem concorrente (message + message.any) para
    -- que ambas escolham o mesmo contato.
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
      -- O telefone ja e canonico. Conserva o alias LID para auditoria e para
      -- uma reconciliacao assistida caso exista legado anterior separado.
      update public.contacts
         set display_name = coalesce(display_name, nullif(p_notify, '')),
             source_metadata = coalesce(source_metadata, '{}'::jsonb)
               || jsonb_build_object('waha_lid', p_lid, 'waha_chat_id', p_chat_id),
             updated_at = now()
       where id = v_phone_id;
      return v_phone_id;
    end if;

    if v_lid_id is not null then
      -- Nao existe contato pelo telefone: enriquece o proprio contato LID.
      -- A generated wa_identity muda atomicamente de lid:* para phone:*.
      update public.contacts
         set phone_number = p_phone,
             display_name = coalesce(display_name, nullif(p_notify, '')),
             source_metadata = coalesce(source_metadata, '{}'::jsonb)
               || jsonb_build_object('waha_lid', p_lid, 'waha_chat_id', p_chat_id),
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
        'notify_name', nullif(p_notify, '')
      ),
      nullif(p_notify, '')
    )
    on conflict (organization_id, wa_identity)
      where wa_identity is not null and is_merged_into is null
    do update set
      display_name = coalesce(contacts.display_name, excluded.display_name),
      source_metadata = coalesce(contacts.source_metadata, '{}'::jsonb)
        || excluded.source_metadata,
      updated_at = now()
    returning id into v_id;
    return v_id;
  end if;

  -- Compatibilidade com eventos cujo LID ainda nao esteja mapeado e com
  -- eventos @c.us/@s.whatsapp.net que ja trazem o telefone diretamente.
  insert into public.contacts (
    organization_id, phone_number, source, consent, tags, source_metadata, display_name
  ) values (
    p_org,
    case when p_kind = 'phone' then p_phone end,
    'whatsapp',
    '{}'::jsonb,
    '{}'::text[],
    case when p_kind = 'lid'
      then jsonb_build_object('waha_lid', p_lid, 'notify_name', nullif(p_notify, ''))
      else jsonb_build_object('waha_chat_id', p_chat_id, 'notify_name', nullif(p_notify, '')) end,
    nullif(p_notify, '')
  )
  on conflict (organization_id, wa_identity)
    where wa_identity is not null and is_merged_into is null
  do update set
    display_name = coalesce(contacts.display_name, excluded.display_name),
    source_metadata = coalesce(contacts.source_metadata, '{}'::jsonb)
      || excluded.source_metadata,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.fn_upsert_wa_contact is
  'Resolve/cria contato WhatsApp por telefone/LID e enriquece LID mapeado sem duplicar o contato corrente.';

revoke all on function public.fn_upsert_wa_contact(uuid, text, text, text, text, text) from public;
revoke execute on function public.fn_upsert_wa_contact(uuid, text, text, text, text, text) from anon;
grant execute on function public.fn_upsert_wa_contact(uuid, text, text, text, text, text) to service_role;
