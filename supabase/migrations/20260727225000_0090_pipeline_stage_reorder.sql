-- 0090 — reordenação transacional de etapas sem colisão de position.
create or replace function public.fn_reorder_pipeline_stage(p_pipeline uuid,p_stage uuid,p_direction integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_current integer; v_target_id uuid; v_target integer;
begin
  if p_direction not in (-1,1) then raise exception 'invalid_direction'; end if;
  select organization_id,position into v_org,v_current from public.crm_stages
   where id=p_stage and pipeline_id=p_pipeline and is_archived=false for update;
  if v_org is null then return false; end if;
  if auth.uid() is not null and not public.fn_role_at_least(v_org,'admin') then raise exception 'forbidden'; end if;
  if p_direction=-1 then
    select id,position into v_target_id,v_target from public.crm_stages
     where pipeline_id=p_pipeline and organization_id=v_org and is_archived=false and position<v_current
     order by position desc limit 1 for update;
  else
    select id,position into v_target_id,v_target from public.crm_stages
     where pipeline_id=p_pipeline and organization_id=v_org and is_archived=false and position>v_current
     order by position asc limit 1 for update;
  end if;
  if v_target_id is null then return false; end if;
  update public.crm_stages set position=position+100000,updated_at=now() where id in (p_stage,v_target_id);
  update public.crm_stages set position=case when id=p_stage then v_target else v_current end,updated_at=now()
   where id in (p_stage,v_target_id);
  return true;
end $$;
revoke all on function public.fn_reorder_pipeline_stage(uuid,uuid,integer) from public,anon;
grant execute on function public.fn_reorder_pipeline_stage(uuid,uuid,integer) to authenticated,service_role;

create or replace function public.fn_reorder_pipeline(p_pipeline uuid,p_direction integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_current integer; v_target_id uuid; v_target integer;
begin
  if p_direction not in (-1,1) then raise exception 'invalid_direction'; end if;
  select organization_id,position into v_org,v_current from public.crm_pipelines where id=p_pipeline and is_archived=false for update;
  if v_org is null then return false; end if;
  if not public.fn_role_at_least(v_org,'admin') then raise exception 'forbidden'; end if;
  select id,position into v_target_id,v_target from public.crm_pipelines
   where organization_id=v_org and is_archived=false
     and ((p_direction=-1 and position<v_current) or (p_direction=1 and position>v_current))
   order by case when p_direction=-1 then -position else position end asc limit 1 for update;
  if v_target_id is null then return false; end if;
  update public.crm_pipelines set position=position+100000,updated_at=now() where id in (p_pipeline,v_target_id);
  update public.crm_pipelines set position=case when id=p_pipeline then v_target else v_current end,updated_at=now()
   where id in (p_pipeline,v_target_id);
  return true;
end; $$;
revoke all on function public.fn_reorder_pipeline(uuid,integer) from public,anon;
grant execute on function public.fn_reorder_pipeline(uuid,integer) to authenticated,service_role;

create or replace function public.fn_archive_pipeline_stage(p_pipeline uuid,p_stage uuid,p_target uuid default null)
returns integer language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_count integer;
begin
  select organization_id into v_org from public.crm_stages
   where id=p_stage and pipeline_id=p_pipeline and is_archived=false for update;
  if v_org is null then raise exception 'stage_not_found'; end if;
  if not public.fn_role_at_least(v_org,'admin') then raise exception 'forbidden'; end if;

  select count(*)::integer into v_count from public.crm_leads
   where organization_id=v_org and pipeline_id=p_pipeline and stage_id=p_stage;
  if v_count>0 and p_target is null then raise exception 'migration_target_required'; end if;
  if p_target is not null and not exists (
    select 1 from public.crm_stages where id=p_target and pipeline_id=p_pipeline
      and organization_id=v_org and is_archived=false and id<>p_stage
  ) then raise exception 'invalid_migration_target'; end if;

  if p_target is not null then
    update public.crm_leads set stage_id=p_target,stage_changed_at=now(),updated_at=now()
     where organization_id=v_org and pipeline_id=p_pipeline and stage_id=p_stage;
  end if;
  update public.crm_stages set is_archived=true,updated_at=now() where id=p_stage;
  return v_count;
end; $$;
revoke all on function public.fn_archive_pipeline_stage(uuid,uuid,uuid) from public,anon;
grant execute on function public.fn_archive_pipeline_stage(uuid,uuid,uuid) to authenticated,service_role;
