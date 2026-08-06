-- 0118_release_restores_general_ai_rule
-- Pegar para mim pausa a IA. Ao liberar, a conversa volta a herdar a chave
-- geral da organização; com IA geral desligada, ela não continua como exceção.

create or replace function public.fn_conversation_assign(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_to_user_id uuid,
  p_reason text,
  p_expected_assignee uuid default null,
  p_enforce_expected boolean default false
) returns setof public.conversations
language plpgsql security definer
set search_path = public
as $$
declare
  v_from uuid;
  v_contact_id uuid;
  v_conv public.conversations%rowtype;
begin
  if auth.uid() is not null
     and not public.fn_role_at_least(p_organization_id, 'agent') then
    raise exception 'caller_not_authorized_for_org';
  end if;
  if p_to_user_id is not null then
    if coalesce(public.fn_member_role_in_org(p_to_user_id,p_organization_id),'none')
       not in ('agent','manager','admin') then
      raise exception 'assignee_not_eligible_member';
    end if;
  end if;

  select assigned_to_user_id, contact_id into v_from, v_contact_id
  from public.conversations
  where id=p_conversation_id and organization_id=p_organization_id
  for update;
  if not found then return; end if;
  if p_enforce_expected and v_from is distinct from p_expected_assignee then return; end if;

  update public.conversations
     set assigned_to_user_id=p_to_user_id,
         assigned_at=case when p_to_user_id is null then null else now() end,
         assignee_kind=case when p_to_user_id is null then null else 'user' end,
         status=case when p_to_user_id is null then 'open' else 'claimed' end,
         status_changed_at=now(),
         unread_count_for_assignee=0,
         ai_control_mode=case when p_to_user_id is null then 'inherit' else 'force_paused' end,
         bot_silenced_until=case when p_to_user_id is null then null else 'infinity'::timestamptz end,
         updated_at=now()
   where id=p_conversation_id
   returning * into v_conv;

  -- O motor considera o handoff no nível do contato e também qualquer silêncio
  -- ainda aberto em conversas antigas. Liberar atendimento precisa remover
  -- essas travas para que a conversa volte de fato à chave geral.
  if p_to_user_id is null then
    update public.contacts
       set force_human=false,
           updated_at=now()
     where id=v_contact_id and organization_id=p_organization_id;

    update public.conversations
       set bot_silenced_until=null,
           updated_at=now()
     where organization_id=p_organization_id and contact_id=v_contact_id;
  end if;

  insert into public.conversation_assignment_events
    (organization_id,conversation_id,from_user_id,to_user_id,changed_by,reason)
  values (p_organization_id,p_conversation_id,v_from,p_to_user_id,auth.uid(),p_reason);

  return next v_conv;
end;
$$;

revoke all on function public.fn_conversation_assign(uuid,uuid,uuid,text,uuid,boolean) from public, anon;
grant execute on function public.fn_conversation_assign(uuid,uuid,uuid,text,uuid,boolean)
  to authenticated, service_role;
