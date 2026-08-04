-- Troca atomica do pipeline principal. Aplicar somente na etapa final de banco.
with ranked as (
  select id,
         row_number() over (
           partition by organization_id
           order by updated_at desc nulls last, created_at, id
         ) as position
  from public.crm_pipelines
  where is_default=true and is_archived=false
)
update public.crm_pipelines p
set is_default=false, updated_at=now()
from ranked r
where p.id=r.id and r.position>1;

create unique index if not exists uniq_crm_pipelines_default_per_org
  on public.crm_pipelines(organization_id)
  where is_default=true and is_archived=false;

create or replace function public.fn_set_default_pipeline(p_pipeline uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org
  from public.crm_pipelines
  where id = p_pipeline and is_archived = false
  for update;

  if v_org is null or v_org not in (select public.fn_user_org_ids()) then
    return false;
  end if;

  if not public.fn_role_at_least(v_org, 'admin') and not public.fn_is_platform_admin() then
    raise exception 'Permissao insuficiente para alterar o pipeline principal';
  end if;

  perform 1 from public.crm_pipelines
  where organization_id = v_org
  for update;

  update public.crm_pipelines
  set is_default = (id = p_pipeline), updated_at = now()
  where organization_id = v_org and is_archived = false;

  return true;
end;
$$;

revoke all on function public.fn_set_default_pipeline(uuid) from public, anon;
grant execute on function public.fn_set_default_pipeline(uuid) to authenticated, service_role;
