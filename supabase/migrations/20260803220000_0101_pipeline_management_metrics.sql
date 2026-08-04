-- Indicadores gerenciais do Kanban. Aplicar somente na etapa final de banco.
create or replace function public.fn_pipeline_management_metrics(
  p_org uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_pipeline uuid default null
) returns jsonb
language sql stable
security invoker
set search_path = public
as $$
  with scoped_leads as (
    select l.*
    from public.crm_leads l
    where l.organization_id = p_org
      and (p_pipeline is null or l.pipeline_id = p_pipeline)
  ),
  transitions as (
    select
      a.lead_id,
      a.performed_at as event_at,
      (a.payload->>'to_stage_id')::uuid as stage_id
    from public.crm_lead_activities a
    join scoped_leads l on l.id = a.lead_id
    where a.organization_id = p_org
      and a.type = 'stage_changed'
      and coalesce(a.payload->>'to_stage_id', '') ~* '^[0-9a-f-]{36}$'
  ),
  entries as (
    select
      l.id as lead_id,
      l.created_at as event_at,
      coalesce(
        (select (a.payload->>'from_stage_id')::uuid
         from public.crm_lead_activities a
         where a.lead_id = l.id and a.type = 'stage_changed'
           and coalesce(a.payload->>'from_stage_id', '') ~* '^[0-9a-f-]{36}$'
         order by a.performed_at asc limit 1),
        l.stage_id
      ) as stage_id
    from scoped_leads l
    union all
    select lead_id, event_at, stage_id from transitions
  ),
  segments as (
    select
      lead_id,
      stage_id,
      event_at,
      lead(event_at, 1, least(p_to, now())) over (partition by lead_id order by event_at) as next_at
    from entries
  ),
  duration_by_stage as (
    select
      stage_id,
      count(*) filter (where event_at >= p_from and event_at < p_to) as entries,
      avg(extract(epoch from (
        least(next_at, p_to) - greatest(event_at, p_from)
      ))) filter (where greatest(event_at, p_from) < least(next_at, p_to)) as avg_seconds
    from segments
    group by stage_id
  ),
  current_by_stage as (
    select stage_id, count(*) as open_count, coalesce(sum(value_cents), 0) as value_cents
    from scoped_leads where status = 'open' group by stage_id
  ),
  outcomes as (
    select
      count(*) filter (where status = 'won') as won,
      count(*) filter (where status = 'lost') as lost,
      coalesce(sum(value_cents) filter (where status = 'won'), 0) as won_value_cents,
      coalesce(sum(value_cents) filter (where status = 'lost'), 0) as lost_value_cents
    from scoped_leads
    where closed_at >= p_from and closed_at < p_to
  ),
  owners as (
    select
      owner_kind,
      owner_user_id,
      owner_agent_id,
      count(*) as open_count,
      coalesce(sum(value_cents), 0) as value_cents
    from scoped_leads
    where status = 'open'
    group by owner_kind, owner_user_id, owner_agent_id
  )
  select jsonb_build_object(
    'stages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'stage_id', s.id,
        'stage_name', s.name,
        'position', s.position,
        'open_count', coalesce(c.open_count, 0),
        'value_cents', coalesce(c.value_cents, 0),
        'entries', coalesce(d.entries, 0),
        'avg_seconds', d.avg_seconds
      ) order by p.position, s.position)
      from public.crm_stages s
      join public.crm_pipelines p on p.id = s.pipeline_id
      left join current_by_stage c on c.stage_id = s.id
      left join duration_by_stage d on d.stage_id = s.id
      where s.organization_id = p_org and s.is_archived = false
        and (p_pipeline is null or s.pipeline_id = p_pipeline)
    ), '[]'::jsonb),
    'outcomes', (select to_jsonb(outcomes) from outcomes),
    'owners', coalesce((select jsonb_agg(to_jsonb(owners)) from owners), '[]'::jsonb)
  );
$$;

revoke all on function public.fn_pipeline_management_metrics(uuid,timestamptz,timestamptz,uuid)
  from public, anon;
grant execute on function public.fn_pipeline_management_metrics(uuid,timestamptz,timestamptz,uuid)
  to authenticated, service_role;

