-- Per-conversation AI control. Independent from handoff silence so a manual
-- preference never erases the safety/audit state of a human handoff.
alter table public.conversations
  add column if not exists ai_control_mode text not null default 'inherit';

alter table public.conversations
  drop constraint if exists conversations_ai_control_mode_check;

alter table public.conversations
  add constraint conversations_ai_control_mode_check
  check (ai_control_mode in ('inherit', 'force_active', 'force_paused'));

comment on column public.conversations.ai_control_mode is
  'inherit=segue agente global; force_active=autoriza teste individual; force_paused=bloqueia IA neste contato';
