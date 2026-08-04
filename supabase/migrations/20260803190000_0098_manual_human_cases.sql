-- 0098 — permite que um atendente abra manualmente um caso pelo Inbox.
alter table public.agent_cases
  drop constraint if exists agent_cases_source_check;

alter table public.agent_cases
  add constraint agent_cases_source_check
  check (source in ('agent', 'guardrail_autofallback', 'manual'));

comment on column public.agent_cases.source is
  'Origem do caso: agente, fallback de seguranca ou abertura manual pelo Inbox.';
