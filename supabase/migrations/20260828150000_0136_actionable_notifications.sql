-- 0136_actionable_notifications
-- Notificacoes devem pedir uma acao. Anexos recebidos continuam no Inbox,
-- mas deixam de lotar o sino. Conexoes arquivadas deixam de gerar alertas.

create or replace function public.fn_notify_message_event()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.direction = 'outbound'
     and new.status = 'failed'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.fn_emit_notification(
      new.organization_id,
      'send_failed',
      'critical',
      'Falha ao enviar mensagem',
      coalesce(new.error_message, 'Verifique a conversa e tente novamente.'),
      '/app/inbox?conversation=' || new.conversation_id,
      'message',
      new.id,
      'message-failed-' || new.id
    );
  end if;
  return new;
end $$;

-- Preserva o historico, retirando apenas o ruido da caixa de nao lidas.
update public.notification_events
   set resolved_at = coalesce(resolved_at, now())
 where category = 'file_received'
   and resolved_at is null;

create or replace function public.fn_notify_channel_disconnected()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_old_is_down boolean := lower(coalesce(old.status, '')) in ('failed','stopped','disconnected','error');
  v_new_is_down boolean := lower(coalesce(new.status, '')) in ('failed','stopped','disconnected','error');
begin
  if new.archived_at is not null then
    update public.notification_events
       set resolved_at = coalesce(resolved_at, now())
     where organization_id = new.organization_id
       and category = 'whatsapp_disconnected'
       and resource_type = 'channel_session'
       and resource_id = new.id
       and resolved_at is null;
  elsif v_new_is_down and not v_old_is_down then
    if not exists (
      select 1 from public.notification_events e
       where e.organization_id = new.organization_id
         and e.category = 'whatsapp_disconnected'
         and e.resource_type = 'channel_session'
         and e.resource_id = new.id
         and e.resolved_at is null
    ) then
      perform public.fn_emit_notification(
        new.organization_id,
        'whatsapp_disconnected',
        'critical',
        'WhatsApp desconectado',
        coalesce(new.status_reason, 'A conexao precisa ser verificada.'),
        '/app/connections',
        'channel_session',
        new.id,
        'channel-down-' || new.id || '-' || extract(epoch from coalesce(new.last_status_change_at, now()))::bigint
      );
    end if;
  elsif not v_new_is_down and v_old_is_down then
    update public.notification_events
       set resolved_at = coalesce(resolved_at, now())
     where organization_id = new.organization_id
       and category = 'whatsapp_disconnected'
       and resource_type = 'channel_session'
       and resource_id = new.id
       and resolved_at is null;
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_channel_disconnected on public.channel_sessions;
create trigger trg_notify_channel_disconnected
after update of status, archived_at on public.channel_sessions
for each row execute function public.fn_notify_channel_disconnected();

revoke execute on function public.fn_notify_message_event() from public,anon,authenticated;
revoke execute on function public.fn_notify_channel_disconnected() from public,anon,authenticated;
