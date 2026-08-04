alter table public.conversations
  add column if not exists selected_agent_id uuid references public.ai_agents(id) on delete set null,
  add column if not exists agent_selection_mode text not null default 'inherit'
    check (agent_selection_mode in ('inherit','manual')),
  add column if not exists agent_selection_reason text,
  add column if not exists agent_selected_at timestamptz,
  add column if not exists agent_selected_by_user_id uuid references auth.users(id) on delete set null;
alter table public.conversations
  add column if not exists effective_agent_id uuid references public.ai_agents(id) on delete set null,
  add column if not exists effective_agent_reason text,
  add column if not exists effective_agent_at timestamptz;

create table if not exists public.conversation_agent_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  from_agent_id uuid references public.ai_agents(id) on delete set null,
  to_agent_id uuid references public.ai_agents(id) on delete set null,
  selection_mode text not null check (selection_mode in ('inherit','manual','connection','origin','stage')),
  reason text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_conversation_agent_events_conversation
  on public.conversation_agent_events (organization_id, conversation_id, created_at desc);

alter table public.conversation_agent_events enable row level security;
drop policy if exists tenant_isolation_conversation_agent_events on public.conversation_agent_events;
create policy tenant_isolation_conversation_agent_events on public.conversation_agent_events
  for all using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));

comment on column public.conversations.selected_agent_id is
  'Escolha manual que prevalece sobre regras automáticas; não ativa a IA durante atendimento humano.';
