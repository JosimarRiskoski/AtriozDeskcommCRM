-- The two worker reapers run even when there are no expired leases. Keep their
-- empty scans bounded to the active status and expiration timestamp rather
-- than walking historical event/job rows on every tick.
create index if not exists event_log_agent_processing_reap_idx
  on public.event_log (event_type, updated_at)
  where status = 'processing';

create index if not exists job_queue_running_reap_idx
  on public.job_queue (locked_at)
  where status = 'running';
