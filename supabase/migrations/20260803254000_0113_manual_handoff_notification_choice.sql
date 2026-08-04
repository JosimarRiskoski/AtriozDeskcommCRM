-- 0113_manual_handoff_notification_choice
-- Respeita a escolha feita ao criar manualmente um caso humano: avisar ou nao
-- o grupo de gestores, sem deixar de criar a notificacao interna do CRM.

create or replace function public.fn_notify_human_case_opened()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.fn_emit_notification(new.organization_id,'human_handoff',
    case when new.urgency='critical' then 'critical' else 'warning' end,
    'Novo caso humano: '||new.title,new.summary,'/app/ai/cases','agent_case',new.id,
    'human-case-'||new.id,new.assignee_user_id,
    jsonb_build_object(
      'case_id',new.id,
      'urgency',new.urgency,
      'conversation_id',new.conversation_id,
      'notify_manager_group',coalesce((new.context_snapshot->>'notify_manager_group')::boolean,true),
      'conversation_url',new.context_snapshot->>'conversation_url'
    ));
  return new;
end $$;

create or replace function public.fn_human_support_group_fanout()
returns trigger language plpgsql security definer set search_path=public as $$
declare s public.human_support_settings%rowtype; v_enabled boolean;
begin
  if coalesce((new.metadata->>'notify_manager_group')::boolean,true)=false then return new; end if;
  select * into s from public.human_support_settings where organization_id=new.organization_id;
  if not found or not s.notify_whatsapp_group or s.whatsapp_connection_id is null or s.whatsapp_group_chat_id is null then return new; end if;
  v_enabled := case new.category
    when 'human_handoff' then s.group_notify_handoffs
    when 'whatsapp_disconnected' then s.group_notify_connection_down
    when 'ai_budget' then s.group_notify_ai_budget
    when 'campaign_interrupted' then s.group_notify_campaign_paused
    when 'send_failed' then s.group_notify_crm_errors
    when 'ai_failure' then s.group_notify_crm_errors
    else false end;
  if v_enabled then
    insert into public.whatsapp_group_notification_deliveries(event_id,organization_id,connection_id,group_chat_id)
    values(new.id,new.organization_id,s.whatsapp_connection_id,s.whatsapp_group_chat_id)
    on conflict do nothing;
  end if;
  return new;
end $$;

revoke execute on function public.fn_notify_human_case_opened() from public,anon,authenticated;
revoke execute on function public.fn_human_support_group_fanout() from public,anon,authenticated;

