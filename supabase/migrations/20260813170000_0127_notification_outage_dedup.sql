-- 0127_notification_outage_dedup
-- Uma indisponibilidade do WhatsApp deve gerar um unico alerta aberto, mesmo
-- quando o provedor alterna entre FAILED, STOPPED, DISCONNECTED e ERROR.

create or replace function public.fn_notify_channel_disconnected()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_old_is_down boolean := lower(coalesce(old.status, '')) in ('failed','stopped','disconnected','error');
  v_new_is_down boolean := lower(coalesce(new.status, '')) in ('failed','stopped','disconnected','error');
begin
  if v_new_is_down and not v_old_is_down then
    if not exists (
      select 1
        from public.notification_events e
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

-- Corrige o legado: para cada conexao, apenas o alerta mais recente permanece
-- aberto. Os demais continuam consultaveis em "Todas" como historico resolvido.
with ranked as (
  select id,
         row_number() over (
           partition by organization_id, resource_id
           order by created_at desc, id desc
         ) as position
    from public.notification_events
   where category = 'whatsapp_disconnected'
     and resource_type = 'channel_session'
     and resolved_at is null
)
update public.notification_events e
   set resolved_at = now()
  from ranked r
 where e.id = r.id
   and r.position > 1;
