-- 0116_ai_control_reactivate_handoff
-- "Devolver para IA" precisa desfazer TODAS as travas de handoff daquela
-- conversa: ai_control_mode, bot_silenced_until e force_human do contato.
-- A transação não toca em is_blocked: opt-out/LGPD permanece soberano.

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

  select c.contact_id, c.bot_silenced_until is not null
    into v_contact_id, v_was_silenced
  from public.conversations c
  where c.id = p_conversation_id and c.organization_id = p_organization_id
  for update;
  if not found then return; end if;

  select c.force_human, c.is_blocked
    into v_was_force_human, v_is_blocked
  from public.contacts c
  where c.id = v_contact_id and c.organization_id = p_organization_id
  for update;
  if not found then return; end if;

  if p_mode = 'force_active' and v_is_blocked then
    raise exception 'contact_communication_blocked';
  end if;

  -- force_human é um bloqueio no nível do contato e o motor também verifica
  -- silêncios pendentes em QUALQUER conversa dele. Ao devolver para IA, limpar
  -- somente a conversa aberta deixaria uma conversa antiga bloqueando o turno.
  if p_mode = 'force_active' then
    update public.conversations
    set bot_silenced_until = null,
        updated_at = now()
    where organization_id = p_organization_id and contact_id = v_contact_id;
  end if;

  update public.conversations c
  set ai_control_mode = p_mode,
      updated_at = now()
  where c.id = p_conversation_id and c.organization_id = p_organization_id;

  if p_mode = 'force_active' and v_was_force_human then
    update public.contacts
    set force_human = false,
        updated_at = now()
    where id = v_contact_id and organization_id = p_organization_id;
  end if;

  return query
  select c.id,
         c.contact_id,
         c.ai_control_mode,
         c.bot_silenced_until,
         p_mode = 'force_active' and (v_was_silenced or v_was_force_human)
  from public.conversations c
  where c.id = p_conversation_id and c.organization_id = p_organization_id;
end;
$$;

revoke all on function public.fn_set_conversation_ai_control(uuid, uuid, text) from public, anon;
grant execute on function public.fn_set_conversation_ai_control(uuid, uuid, text)
  to authenticated, service_role;
