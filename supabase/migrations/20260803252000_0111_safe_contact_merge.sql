-- 0111_safe_contact_merge
-- Mesclagem assistida: nunca escolhe automaticamente o registro principal e
-- recusa cenarios em que duas linhas ativas colidiriam.

create or replace function public.fn_merge_contacts_safe(
  p_primary uuid,
  p_duplicate uuid,
  p_queue uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_primary public.contacts%rowtype;
  v_duplicate public.contacts%rowtype;
  v_table text;
  v_phone text;
  v_primary_digits text;
  v_duplicate_digits text;
begin
  if p_primary = p_duplicate then raise exception 'merge_same_contact'; end if;

  select * into v_primary from public.contacts where id=p_primary for update;
  select * into v_duplicate from public.contacts where id=p_duplicate for update;
  if v_primary.id is null or v_duplicate.id is null then raise exception 'merge_contact_not_found'; end if;
  if v_primary.organization_id <> v_duplicate.organization_id then raise exception 'merge_cross_tenant'; end if;
  v_org := v_primary.organization_id;
  if not public.fn_role_at_least(v_org, 'manager') then raise exception 'merge_forbidden'; end if;
  if v_primary.is_merged_into is not null or v_duplicate.is_merged_into is not null then
    raise exception 'merge_already_resolved';
  end if;
  if v_primary.is_anonymized or v_duplicate.is_anonymized then raise exception 'merge_anonymized_contact'; end if;

  v_primary_digits := regexp_replace(coalesce(v_primary.phone_number,''),'\D','','g');
  v_duplicate_digits := regexp_replace(coalesce(v_duplicate.phone_number,''),'\D','','g');
  if not (
    v_primary_digits = v_duplicate_digits
    or (
      length(v_primary_digits)=13 and length(v_duplicate_digits)=12
      and v_primary_digits ~ '^55[1-9][0-9]9[6-9][0-9]{7}$'
      and overlay(v_primary_digits placing '' from 5 for 1)=v_duplicate_digits
    )
    or (
      length(v_duplicate_digits)=13 and length(v_primary_digits)=12
      and v_duplicate_digits ~ '^55[1-9][0-9]9[6-9][0-9]{7}$'
      and overlay(v_duplicate_digits placing '' from 5 for 1)=v_primary_digits
    )
  ) then raise exception 'merge_phone_identity_mismatch'; end if;

  if exists (
    select 1 from public.conversations a
    join public.conversations b
      on b.organization_id=a.organization_id
     and b.channel_session_id=a.channel_session_id
     and b.is_group=false and a.is_group=false
    where a.contact_id=p_primary and b.contact_id=p_duplicate
  ) then raise exception 'merge_overlap_conversations'; end if;

  if to_regclass('public.followup_enrollments') is not null and exists (
    select 1 from public.followup_enrollments a
    join public.followup_enrollments b on b.pointer_id=a.pointer_id
    where a.contact_id=p_primary and b.contact_id=p_duplicate
      and a.status in ('active','paused') and b.status in ('active','paused')
  ) then raise exception 'merge_overlap_followups'; end if;

  if to_regclass('public.lead_state') is not null
     and exists(select 1 from public.lead_state where contact_id=p_primary)
     and exists(select 1 from public.lead_state where contact_id=p_duplicate)
  then raise exception 'merge_overlap_agent_state'; end if;

  -- Primeiro retira o duplicado dos indices parciais e preserva seus valores
  -- originais no historico interno. A linha continua existindo como mapa.
  update public.contacts
     set is_merged_into=p_primary,
         merged_at=now(),
         source_metadata=coalesce(source_metadata,'{}'::jsonb) || jsonb_build_object(
           'merged_original_phone', phone_number,
           'merged_original_email', email,
           'merged_into', p_primary,
           'merged_at', now()
         ),
         phone_number=null,
         email=null,
         email_normalized=null,
         updated_at=now()
   where id=p_duplicate;

  foreach v_table in array array[
    'conversations','messages','ai_agent_runs','crm_lead_activities','crm_leads',
    'lgpd_requests','orders','job_queue','send_ledger','llm_calls','lead_checkpoints',
    'lead_state','lead_state_transitions','cron_jobs','lead_notes','before_send_traces',
    'followup_enrollments','outreach_campaign_recipients','contact_source_events',
    'contact_communication_events','conversation_continuations','webhook_source_intents',
    'webhook_source_receipts'
  ] loop
    if to_regclass('public.' || v_table) is not null
       and exists(
         select 1 from pg_attribute
         where attrelid=to_regclass('public.' || v_table)
           and attname='contact_id' and not attisdropped
       ) then
      execute format('update public.%I set contact_id=$1 where contact_id=$2', v_table)
        using p_primary, p_duplicate;
    end if;
  end loop;

  v_phone := coalesce(
    case when v_primary.phone_number ~ '^\+55[1-9][0-9]9[6-9][0-9]{7}$' then v_primary.phone_number end,
    case when v_duplicate.phone_number ~ '^\+55[1-9][0-9]9[6-9][0-9]{7}$' then v_duplicate.phone_number end,
    v_primary.phone_number,
    v_duplicate.phone_number
  );

  update public.contacts
     set phone_number=v_phone,
         display_name=coalesce(
           nullif(case when coalesce(display_name,'') !~ '^Contato ' then display_name end,''),
           nullif(case when coalesce(v_duplicate.display_name,'') !~ '^Contato ' then v_duplicate.display_name end,''),
           display_name,
           v_duplicate.display_name
         ),
         name=coalesce(name,v_duplicate.name),
         email=coalesce(email,v_duplicate.email),
         company=coalesce(company,v_duplicate.company),
         city=coalesce(city,v_duplicate.city),
         state=coalesce(state,v_duplicate.state),
         tags=(select array(select distinct unnest(coalesce(v_primary.tags,'{}') || coalesce(v_duplicate.tags,'{}')))),
         custom_fields=coalesce(v_duplicate.custom_fields,'{}'::jsonb) || coalesce(v_primary.custom_fields,'{}'::jsonb),
         source_metadata=coalesce(v_duplicate.source_metadata,'{}'::jsonb) || coalesce(v_primary.source_metadata,'{}'::jsonb),
         updated_at=now()
   where id=p_primary;

  if p_queue is not null then
    update public.merge_queue
       set status='resolved', resolved_at=now(), resolved_by_user_id=auth.uid(),
           resolution=jsonb_build_object('primary_contact_id',p_primary,'merged_contact_id',p_duplicate)
     where id=p_queue and organization_id=v_org and status='pending';
  end if;

  return p_primary;
end;
$$;

revoke all on function public.fn_merge_contacts_safe(uuid,uuid,uuid) from public, anon;
grant execute on function public.fn_merge_contacts_safe(uuid,uuid,uuid) to authenticated, service_role;

comment on function public.fn_merge_contacts_safe is
  'Mescla dois contatos escolhidos por um gestor; bloqueia colisoes de conversa, follow-up e estado do agente.';
