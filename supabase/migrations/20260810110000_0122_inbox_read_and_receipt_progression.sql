-- 0122: leitura transacional do Inbox e progressao monotona de recibos.

alter table public.messages
  add column if not exists played_at timestamptz;

create or replace function public.fn_advance_message_receipt(
  p_organization_id uuid,
  p_external_ids text[],
  p_ack integer
)
returns table(matched_count integer, updated_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_matched integer := 0;
  v_updated integer := 0;
  v_ack integer := greatest(0, least(coalesce(p_ack, 0), 4));
begin
  select count(*)::integer
    into v_matched
    from public.messages
   where organization_id = p_organization_id
     and direction = 'outbound'
     and external_id = any(coalesce(p_external_ids, array[]::text[]));

  update public.messages
     set ack = greatest(coalesce(ack, 0), v_ack),
         status = case
           when greatest(coalesce(ack, 0), v_ack) >= 3 then 'read'
           when greatest(coalesce(ack, 0), v_ack) >= 2 then 'delivered'
           when greatest(coalesce(ack, 0), v_ack) >= 1 then 'sent'
           else status
         end,
         delivered_at = case
           when v_ack >= 2 then coalesce(delivered_at, now())
           else delivered_at
         end,
         read_at = case
           when v_ack >= 3 then coalesce(read_at, now())
           else read_at
         end,
         played_at = case
           when v_ack >= 4 then coalesce(played_at, now())
           else played_at
         end
   where organization_id = p_organization_id
     and direction = 'outbound'
     and external_id = any(coalesce(p_external_ids, array[]::text[]))
     and coalesce(ack, 0) < v_ack;

  get diagnostics v_updated = row_count;
  return query select v_matched, v_updated;
end;
$$;

comment on function public.fn_advance_message_receipt(uuid, text[], integer) is
  'Avanca recibos outbound sem regressao; retorna mensagens encontradas e alteradas.';

revoke all on function public.fn_advance_message_receipt(uuid, text[], integer) from public, anon, authenticated;
grant execute on function public.fn_advance_message_receipt(uuid, text[], integer) to service_role;

create or replace function public.fn_mark_conversation_read(
  p_organization_id uuid,
  p_conversation_id uuid
)
returns table(marked_messages integer, unread_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marked integer := 0;
begin
  if not exists (
    select 1
      from public.conversations
     where id = p_conversation_id
       and organization_id = p_organization_id
  ) then
    raise exception 'conversation_not_found';
  end if;

  update public.messages
     set status = 'read',
         ack = greatest(coalesce(ack, 0), 3),
         delivered_at = coalesce(delivered_at, now()),
         read_at = coalesce(read_at, now())
   where organization_id = p_organization_id
     and conversation_id = p_conversation_id
     and direction = 'inbound'
     and read_at is null;

  get diagnostics v_marked = row_count;

  update public.conversations
     set unread_count_for_assignee = 0,
         updated_at = now()
   where id = p_conversation_id
     and organization_id = p_organization_id;

  return query select v_marked, 0;
end;
$$;

comment on function public.fn_mark_conversation_read(uuid, uuid) is
  'Marca mensagens inbound e contador da conversa como lidos na mesma transacao.';

revoke all on function public.fn_mark_conversation_read(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_mark_conversation_read(uuid, uuid) to service_role;
