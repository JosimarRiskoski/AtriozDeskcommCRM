-- 0093_metrics_message_delivery
-- Extends the existing attendant metrics payload with auditable message counts.
-- The function remains SECURITY INVOKER so tenant/role RLS continues to define scope.

create or replace function public.fn_attendant_metrics(
  p_org uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_owner uuid default null
) returns jsonb
language sql stable
set search_path = public
as $$
  with
  lead_agg as (
    select owner_user_id as user_id,
      count(*) filter (where status = 'won') as won,
      count(*) filter (where status = 'lost') as lost
    from public.crm_leads
    where organization_id = p_org
      and status in ('won', 'lost')
      and closed_at >= p_from and closed_at < p_to
      and owner_user_id is not null
      and (p_owner is null or owner_user_id = p_owner)
    group by owner_user_id
  ),
  conv_agg as (
    select assigned_to_user_id as user_id, count(*) as conversations_handled
    from public.conversations
    where organization_id = p_org
      and assigned_to_user_id is not null
      and assigned_at >= p_from and assigned_at < p_to
      and (p_owner is null or assigned_to_user_id = p_owner)
    group by assigned_to_user_id
  ),
  ttfr as (
    select c.assigned_to_user_id as user_id,
      avg(extract(epoch from (fr.first_human_out - fr.first_in))) as avg_first_response_seconds
    from public.conversations c
    cross join lateral (
      select
        min(m.sent_at) filter (where m.direction = 'inbound') as first_in,
        min(m.sent_at) filter (
          where m.direction = 'outbound' and m.sent_by_user_id is not null
        ) as first_human_out
      from public.messages m where m.conversation_id = c.id
    ) fr
    where c.organization_id = p_org
      and c.assigned_to_user_id is not null
      and (p_owner is null or c.assigned_to_user_id = p_owner)
      and fr.first_in is not null and fr.first_human_out is not null
      and fr.first_human_out > fr.first_in
      and fr.first_human_out >= p_from and fr.first_human_out < p_to
    group by c.assigned_to_user_id
  ),
  message_agg as (
    select
      count(*) filter (where m.direction = 'inbound') as received,
      count(*) filter (where m.direction = 'outbound') as outbound_recorded,
      count(*) filter (
        where m.direction = 'outbound'
          and (m.delivered_at is not null or m.status in ('delivered', 'read'))
      ) as outbound_delivered,
      count(*) filter (where m.direction = 'outbound' and m.status = 'read') as outbound_read,
      count(*) filter (where m.direction = 'outbound' and m.status = 'failed') as outbound_failed
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.organization_id = p_org
      and m.sent_at >= p_from and m.sent_at < p_to
      and (p_owner is null or c.assigned_to_user_id = p_owner)
  ),
  attendant_ids as (
    select user_id from lead_agg
    union select user_id from conv_agg
    union select user_id from ttfr
  )
  select jsonb_build_object(
    'funnel', coalesce((
      select jsonb_agg(jsonb_build_object(
        'stage_id', s.id, 'stage_name', s.name, 'position', s.position,
        'count', coalesce(l.cnt, 0)
      ) order by s.position, s.name)
      from public.crm_stages s
      left join (
        select stage_id, count(*) as cnt
        from public.crm_leads
        where organization_id = p_org and status = 'open'
          and (p_owner is null or owner_user_id = p_owner)
        group by stage_id
      ) l on l.stage_id = s.id
      where s.organization_id = p_org and s.is_archived = false
    ), '[]'::jsonb),
    'attendants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', a.user_id,
        'won', coalesce(la.won, 0),
        'lost', coalesce(la.lost, 0),
        'conversations_handled', coalesce(ca.conversations_handled, 0),
        'avg_first_response_seconds', tf.avg_first_response_seconds
      ) order by coalesce(la.won, 0) desc, a.user_id)
      from attendant_ids a
      left join lead_agg la on la.user_id = a.user_id
      left join conv_agg ca on ca.user_id = a.user_id
      left join ttfr tf on tf.user_id = a.user_id
    ), '[]'::jsonb),
    'messages', coalesce((select to_jsonb(message_agg) from message_agg), jsonb_build_object(
      'received', 0, 'outbound_recorded', 0, 'outbound_delivered', 0,
      'outbound_read', 0, 'outbound_failed', 0
    ))
  );
$$;

revoke all on function public.fn_attendant_metrics(uuid, timestamptz, timestamptz, uuid) from public;
revoke execute on function public.fn_attendant_metrics(uuid, timestamptz, timestamptz, uuid) from anon;
grant execute on function public.fn_attendant_metrics(uuid, timestamptz, timestamptz, uuid)
  to authenticated, service_role;
