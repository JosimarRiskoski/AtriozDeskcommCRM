-- 0108 — contrato padrão de entrada, experiência 3C e modelo de tráfego pago.
-- Preparada para aplicação posterior; não executada durante as fases.

alter table public.webhook_sources
  add column if not exists provider_type text not null default 'generic',
  add column if not exists credential_scope text not null default 'leads:write',
  add column if not exists create_opportunity boolean not null default true,
  add column if not exists default_channel_session_id uuid references public.channel_sessions(id) on delete set null,
  add column if not exists default_agent_id uuid references public.ai_agents(id) on delete set null,
  add column if not exists activate_ai boolean not null default false,
  add column if not exists followup_flow_id uuid references public.followup_flow_pointers(id) on delete set null,
  add column if not exists automation_enabled boolean not null default false,
  add column if not exists pilot_approved_at timestamptz,
  add column if not exists pilot_approved_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists automation_external_state_field text,
  add column if not exists previous_secret_encrypted bytea,
  add column if not exists token_overlap_until timestamptz,
  add column if not exists last_tested_at timestamptz,
  add column if not exists last_test_status text;

alter table public.webhook_sources
  alter column default_pipeline_id drop not null,
  alter column default_stage_id drop not null;

do $$ begin alter table public.webhook_sources add constraint webhook_sources_provider_type_check
  check (provider_type in ('generic','3c','paid_traffic')); exception when duplicate_object then null; end $$;
do $$ begin alter table public.webhook_sources add constraint webhook_sources_opportunity_config_check
  check (not create_opportunity or (default_pipeline_id is not null and default_stage_id is not null)); exception when duplicate_object then null; end $$;
do $$ begin alter table public.webhook_sources add constraint webhook_sources_automation_pilot_check
  check (not automation_enabled or pilot_approved_at is not null); exception when duplicate_object then null; end $$;
do $$ begin alter table public.webhook_sources add constraint webhook_sources_credential_scope_check
  check (credential_scope='leads:write'); exception when duplicate_object then null; end $$;

create table if not exists public.webhook_source_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  webhook_source_id uuid not null references public.webhook_sources(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  external_id text,
  idempotency_key text not null,
  default_agent_id uuid references public.ai_agents(id) on delete set null,
  activate_ai boolean not null default false,
  followup_flow_id uuid references public.followup_flow_pointers(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','applied','cancelled','failed')),
  metadata jsonb not null default '{}',
  applied_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(webhook_source_id,idempotency_key)
);
alter table public.webhook_source_intents enable row level security;
drop policy if exists webhook_source_intents_select on public.webhook_source_intents;
create policy webhook_source_intents_select on public.webhook_source_intents for select
  using (organization_id in (select public.fn_user_org_ids()));

create index if not exists idx_webhook_source_intents_pending
  on public.webhook_source_intents(organization_id,contact_id) where status='pending';

create table if not exists public.webhook_source_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  webhook_source_id uuid not null references public.webhook_sources(id) on delete cascade,
  external_id text not null,
  contact_id uuid references public.contacts(id) on delete set null,
  lead_id uuid references public.crm_leads(id) on delete set null,
  payload_sha256 text not null,
  received_at timestamptz not null default now(),
  unique(webhook_source_id,external_id)
);
alter table public.webhook_source_receipts enable row level security;
drop policy if exists webhook_source_receipts_select on public.webhook_source_receipts;
create policy webhook_source_receipts_select on public.webhook_source_receipts for select
  using (organization_id in (select public.fn_user_org_ids()));
