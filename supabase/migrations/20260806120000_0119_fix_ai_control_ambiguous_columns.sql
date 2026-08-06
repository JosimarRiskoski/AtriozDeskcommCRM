-- 0119_fix_ai_control_ambiguous_columns
-- Os nomes das colunas de retorno de uma funcao RETURNS TABLE tambem viram
-- variaveis PL/pgSQL. Por isso `contact_id` e `id` sem alias ficavam ambiguos
-- e o botao "Devolver para IA" retornava 500 antes de concluir o handoff.

create or replace function public.fn_set_conversation_ai_control(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_mode text
) returns table (
  id uuid,
  contact_id uuid,
  ai_control_mode text,
  bot_silenced_until timestamptz,
  handoff_cleared boolean
)
language plpgsql security definer
set search_path = public
as $$
declare
  v_contact_id uuid;
  v_was_silenced boolean := false;
  v_was_force_human boolean := false;
  v_is_blocked boolean := false;
begin
  if p_mode not in ('inherit', 'force_active', 'force_paused') then
    raise exception 'invalid_ai_control_mode';
  end if;

  if auth.uid() is not null
     and not public.fn_role_at_least(p_organization_id, 'agent') then
    raise exception 'caller_not_authorized_for_org';
  end if;

  select conversation_row.contact_id,
         conversation_row.bot_silenced_until is not null
    into v_contact_id, v_was_silenced
  from public.conversations as conversation_row
  where conversation_row.id = p_conversation_id
    and conversation_row.organization_id = p_organization_id
  for update;
  if not found then return; end if;

  select contact_row.force_human, contact_row.is_blocked
    into v_was_force_human, v_is_blocked
  from public.contacts as contact_row
  where contact_row.id = v_contact_id
    and contact_row.organization_id = p_organization_id
  for update;
  if not found then return; end if;

  if p_mode = 'force_active' and v_is_blocked then
    raise exception 'contact_communication_blocked';
  end if;

  if p_mode = 'force_active' then
    update public.conversations as conversation_row
    set bot_silenced_until = null,
        updated_at = now()
    where conversation_row.organization_id = p_organization_id
      and conversation_row.contact_id = v_contact_id;
  end if;

  update public.conversations as conversation_row
  set ai_control_mode = p_mode,
      updated_at = now()
  where conversation_row.id = p_conversation_id
    and conversation_row.organization_id = p_organization_id;

  if p_mode = 'force_active' and v_was_force_human then
    update public.contacts as contact_row
    set force_human = false,
        updated_at = now()
    where contact_row.id = v_contact_id
      and contact_row.organization_id = p_organization_id;
  end if;

  return query
  select conversation_row.id,
         conversation_row.contact_id,
         conversation_row.ai_control_mode,
         conversation_row.bot_silenced_until,
         p_mode = 'force_active' and (v_was_silenced or v_was_force_human)
  from public.conversations as conversation_row
  where conversation_row.id = p_conversation_id
    and conversation_row.organization_id = p_organization_id;
end;
$$;

revoke all on function public.fn_set_conversation_ai_control(uuid, uuid, text)
  from public, anon;
grant execute on function public.fn_set_conversation_ai_control(uuid, uuid, text)
  to authenticated, service_role;
