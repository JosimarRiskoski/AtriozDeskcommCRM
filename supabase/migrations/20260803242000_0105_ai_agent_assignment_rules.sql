create table if not exists public.ai_agent_assignment_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 120),
  agent_id uuid not null references public.ai_agents(id) on delete cascade,
  channel_session_id uuid references public.channel_sessions(id) on delete cascade,
  contact_source text,
  stage_id uuid references public.crm_stages(id) on delete cascade,
  allow_stage_switch boolean not null default false,
  priority integer not null default 100 check (priority between 0 and 1000),
  is_active boolean not null default true,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (channel_session_id is not null or contact_source is not null or stage_id is not null),
  check (stage_id is null or allow_stage_switch)
);

create index if not exists idx_ai_agent_assignment_rules_match
  on public.ai_agent_assignment_rules (organization_id, is_active, priority desc);

alter table public.ai_agent_assignment_rules enable row level security;
drop policy if exists tenant_isolation_ai_agent_assignment_rules on public.ai_agent_assignment_rules;
create policy tenant_isolation_ai_agent_assignment_rules on public.ai_agent_assignment_rules
  for all using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));

comment on table public.ai_agent_assignment_rules is
  'Regras automáticas por conexão, origem e etapa. Escolha manual na conversa sempre prevalece.';
