-- Atribuição de custo por agente para limites diário e mensal configuráveis.
alter table public.llm_calls
  add column if not exists agent_id uuid references public.ai_agents(id) on delete set null;

create index if not exists idx_llm_calls_agent_budget
  on public.llm_calls (organization_id, agent_id, created_at desc)
  where agent_id is not null;

comment on column public.llm_calls.agent_id is
  'Agente publicado responsável pela chamada; permite limites diário e mensal por agente.';
