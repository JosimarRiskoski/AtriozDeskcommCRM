-- 0134_atomic_kanban_reorder
-- Move e reordena um card em uma única transação, sem posições fracionárias
-- duplicadas e sem o estado visual "inclinado" que exigia F5.

create or replace function public.fn_move_crm_lead_ordered(
  p_lead_id uuid,
  p_stage_id uuid,
  p_target_index integer,
  p_expected_updated_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_lead public.crm_leads%rowtype;
  v_stage_pipeline uuid;
  v_target_index integer;
  v_destination_count integer;
begin
  select * into v_lead
  from public.crm_leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'lead_not_found';
  end if;
  if v_lead.updated_at is distinct from p_expected_updated_at then
    raise exception 'lead_stage_changed_concurrent';
  end if;

  select pipeline_id into v_stage_pipeline
  from public.crm_stages
  where id = p_stage_id;

  if v_stage_pipeline is null then
    raise exception 'stage_not_found';
  end if;
  if v_stage_pipeline <> v_lead.pipeline_id then
    raise exception 'pipeline_immutable_use_clone';
  end if;

  select count(*) into v_destination_count
  from public.crm_leads
  where stage_id = p_stage_id and id <> p_lead_id;
  v_target_index := greatest(0, least(p_target_index, v_destination_count));

  with existing as (
    select id, row_number() over (order by position_in_stage, id)::integer as old_ord
    from public.crm_leads
    where stage_id = p_stage_id and id <> p_lead_id
  ), desired as (
    select id,
      case when old_ord > v_target_index then old_ord + 1 else old_ord end as new_ord
    from existing
    union all
    select p_lead_id, v_target_index + 1
  )
  update public.crm_leads lead
  set stage_id = case when lead.id = p_lead_id then p_stage_id else lead.stage_id end,
      position_in_stage = desired.new_ord * 1000,
      updated_at = now()
  from desired
  where lead.id = desired.id;

  return p_lead_id;
end;
$$;

revoke all on function public.fn_move_crm_lead_ordered(uuid, uuid, integer, timestamptz) from public;
revoke all on function public.fn_move_crm_lead_ordered(uuid, uuid, integer, timestamptz) from anon;
grant execute on function public.fn_move_crm_lead_ordered(uuid, uuid, integer, timestamptz) to authenticated;

comment on function public.fn_move_crm_lead_ordered(uuid, uuid, integer, timestamptz) is
  'Move um lead e reordena atomicamente a etapa de destino em incrementos de 1000.';
