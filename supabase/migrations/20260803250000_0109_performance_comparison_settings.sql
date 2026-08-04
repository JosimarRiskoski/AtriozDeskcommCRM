-- 0109 — parâmetros auditáveis do comparativo humano x IA.
-- Preparada para aplicação posterior; não executada durante as fases.
create table if not exists public.performance_comparison_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  human_hourly_cost_cents integer check (human_hourly_cost_cents is null or human_hourly_cost_cents >= 0),
  currency text not null default 'BRL',
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.performance_comparison_settings enable row level security;
drop policy if exists performance_comparison_settings_select on public.performance_comparison_settings;
create policy performance_comparison_settings_select on public.performance_comparison_settings for select
  using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists performance_comparison_settings_write on public.performance_comparison_settings;
create policy performance_comparison_settings_write on public.performance_comparison_settings for all
  using (public.fn_role_at_least(organization_id,'admin'))
  with check (public.fn_role_at_least(organization_id,'admin'));
