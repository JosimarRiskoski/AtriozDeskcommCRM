-- 0132_webhook_log_retention
-- Retencao operacional segura: remove apenas logs tecnicos ja processados.
-- Mensagens, conversas, contatos, oportunidades e trilhas de auditoria nao
-- participam desta rotina.

set lock_timeout = '5s';
set statement_timeout = '60s';

create index if not exists idx_webhook_events_log_processed_retention
  on public.webhook_events_log (received_at, id)
  where status = 'processed';

create or replace function public.fn_cleanup_processed_webhook_logs(
  p_older_than interval default interval '14 days',
  p_batch_size integer default 2000
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer := 0;
begin
  if p_older_than < interval '1 day' then
    raise exception 'A retencao minima permitida e de 1 dia';
  end if;

  if p_batch_size < 1 or p_batch_size > 10000 then
    raise exception 'O lote deve ficar entre 1 e 10000';
  end if;

  with candidates as (
    select id
    from public.webhook_events_log
    where status = 'processed'
      and received_at < now() - p_older_than
    order by received_at, id
    limit p_batch_size
  )
  delete from public.webhook_events_log log
  using candidates
  where log.id = candidates.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.fn_cleanup_processed_webhook_logs(interval, integer) from public;
revoke all on function public.fn_cleanup_processed_webhook_logs(interval, integer) from anon;
revoke all on function public.fn_cleanup_processed_webhook_logs(interval, integer) from authenticated;
grant execute on function public.fn_cleanup_processed_webhook_logs(interval, integer) to service_role;

comment on function public.fn_cleanup_processed_webhook_logs(interval, integer) is
  'Apaga em lotes somente logs tecnicos de webhook ja processados; preserva erros, mensagens e dados comerciais.';
