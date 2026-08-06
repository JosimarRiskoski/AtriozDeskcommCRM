-- 0117_reliable_inbound_agent_dispatch
-- A mensagem pode ser persistida antes da emissão para a fila da IA. Esta
-- função torna a emissão idempotente e transacional, para que reentregas do
-- webhook recuperem um dispatch que tenha falhado sem produzir duas respostas.

create or replace function public.fn_emit_ai_agent_dispatch_once(
  p_organization_id uuid,
  p_message_id uuid,
  p_conversation_id uuid,
  p_contact_id uuid,
  p_channel_session_id uuid,
  p_metadata jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and not public.fn_role_at_least(p_organization_id, 'agent') then
    raise exception 'caller_not_authorized_for_org';
  end if;

  -- Serializa apenas tentativas do mesmo message_id. Sem isto duas reentregas
  -- simultâneas poderiam passar pelo NOT EXISTS e criar dois turnos da IA.
  perform pg_advisory_xact_lock(hashtextextended(p_message_id::text, 0));

  if exists (
    select 1
    from public.event_log
    where organization_id = p_organization_id
      and event_type = 'ai_agent.dispatch_requested'
      and entity_kind = 'message'
      and entity_id = p_message_id
  ) then
    return false;
  end if;

  perform public.emit_event(
    'ai_agent.dispatch_requested',
    'message',
    p_message_id,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'conversation_id', p_conversation_id,
      'contact_id', p_contact_id,
      'channel_session_id', p_channel_session_id,
      'inbound_message_id', p_message_id
    ),
    coalesce(p_metadata, '{}'::jsonb),
    p_organization_id
  );
  return true;
end;
$$;

revoke all on function public.fn_emit_ai_agent_dispatch_once(uuid, uuid, uuid, uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.fn_emit_ai_agent_dispatch_once(uuid, uuid, uuid, uuid, uuid, jsonb)
  to authenticated, service_role;
