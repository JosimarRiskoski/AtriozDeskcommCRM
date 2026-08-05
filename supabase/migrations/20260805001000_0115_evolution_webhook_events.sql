-- 0115 — permite registrar eventos recebidos da Evolution API.
-- 0114 já foi aplicada; esta migration é incremental e não altera eventos antigos.

alter table public.webhook_events_log
  drop constraint if exists webhook_events_log_provider_check;

alter table public.webhook_events_log
  add constraint webhook_events_log_provider_check
  check (provider in ('waha', 'evolution', 'nuvemshop', 'generic'));

alter table public.channel_sessions
  drop constraint if exists channel_sessions_engine_check;

alter table public.channel_sessions
  add constraint channel_sessions_engine_check
  check (engine in ('NOWEB', 'WEBJS', 'EVOLUTION'));
