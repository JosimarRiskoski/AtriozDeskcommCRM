-- 0144_meta_capi_stage_rules
-- Regras explícitas e auditáveis para marcos automáticos da Meta CAPI.
-- O trigger apenas cria uma linha na fila local; nunca faz HTTP dentro da transação do CRM.

create table if not exists public.meta_capi_event_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pipeline_id uuid not null references public.crm_pipelines(id) on delete cascade,
  stage_id uuid not null references public.crm_stages(id) on delete cascade,
  event_name text not null check (event_name in ('Lead', 'QualifiedLead', 'Purchase')),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, pipeline_id, stage_id, event_name)
);

create index if not exists idx_meta_capi_event_rules_enabled_stage
  on public.meta_capi_event_rules (organization_id, pipeline_id, stage_id)
  where enabled;

alter table public.meta_conversion_events
  add column if not exists event_origin text not null default 'manual'
    check (event_origin in ('manual', 'automatic')),
  add column if not exists rule_id uuid references public.meta_capi_event_rules(id) on delete set null;

drop index if exists public.uniq_meta_conversion_one_success_per_lead;
create unique index if not exists uniq_meta_conversion_one_success_per_lead_event
  on public.meta_conversion_events (organization_id, lead_id, event_name)
  where status = 'sent';

create index if not exists idx_meta_conversion_rule
  on public.meta_conversion_events (rule_id, created_at desc)
  where rule_id is not null;

create or replace function public.fn_validate_meta_capi_event_rule()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pipeline_org uuid;
  v_stage_org uuid;
  v_stage_pipeline uuid;
begin
  select organization_id into v_pipeline_org
  from public.crm_pipelines
  where id = new.pipeline_id;

  select organization_id, pipeline_id into v_stage_org, v_stage_pipeline
  from public.crm_stages
  where id = new.stage_id;

  if v_pipeline_org is null or v_stage_org is null
     or v_pipeline_org <> new.organization_id
     or v_stage_org <> new.organization_id
     or v_stage_pipeline <> new.pipeline_id then
    raise exception 'meta_capi_rule_stage_pipeline_mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_meta_capi_event_rule on public.meta_capi_event_rules;
create trigger trg_validate_meta_capi_event_rule
before insert or update of organization_id, pipeline_id, stage_id
on public.meta_capi_event_rules
for each row execute function public.fn_validate_meta_capi_event_rule();

create or replace function public.fn_enqueue_meta_capi_stage_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule record;
begin
  -- Atualizações que não movem o card não devem gerar eventos.
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then
    return new;
  end if;

  for v_rule in
    select rule.id, rule.event_name
    from public.meta_capi_event_rules rule
    join public.meta_capi_settings setting
      on setting.organization_id = rule.organization_id
     and setting.enabled = true
    where rule.organization_id = new.organization_id
      and rule.pipeline_id = new.pipeline_id
      and rule.stage_id = new.stage_id
      and rule.enabled = true
      -- Purchase só é elegível quando o estágio configurado realmente fecha como ganho.
      and (rule.event_name <> 'Purchase' or new.status = 'won')
  loop
    insert into public.meta_conversion_events(
      organization_id,
      lead_id,
      event_name,
      event_id,
      event_origin,
      rule_id,
      requested_at,
      request_summary
    ) values (
      new.organization_id,
      new.id,
      v_rule.event_name,
      'crm-meta:' || new.id::text || ':' || lower(v_rule.event_name),
      'automatic',
      v_rule.id,
      now(),
      jsonb_build_object('source', 'stage_rule', 'pipeline_id', new.pipeline_id, 'stage_id', new.stage_id)
    ) on conflict (organization_id, event_id) do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_enqueue_meta_capi_stage_event on public.crm_leads;
create trigger trg_enqueue_meta_capi_stage_event
after insert or update on public.crm_leads
for each row execute function public.fn_enqueue_meta_capi_stage_event();

alter table public.meta_capi_event_rules enable row level security;

drop policy if exists meta_capi_event_rules_manager on public.meta_capi_event_rules;
create policy meta_capi_event_rules_manager on public.meta_capi_event_rules
for all
using (
  exists (
    select 1
    from public.user_organizations member
    where member.organization_id = meta_capi_event_rules.organization_id
      and member.user_id = auth.uid()
      and member.revoked_at is null
      and member.role in ('manager', 'admin')
  )
)
with check (
  exists (
    select 1
    from public.user_organizations member
    where member.organization_id = meta_capi_event_rules.organization_id
      and member.user_id = auth.uid()
      and member.revoked_at is null
      and member.role in ('manager', 'admin')
  )
);

comment on table public.meta_capi_event_rules is
  'Mapeia explicitamente uma etapa de um funil a um evento Meta CAPI. Desligada por padrão.';
comment on column public.meta_conversion_events.event_origin is
  'manual exige confirmação humana; automatic foi criado por uma regra de etapa habilitada.';
