-- A fila genérica seleciona por tipo, elegibilidade e ordem de criação. O
-- índice anterior começava por organization_id, campo que este worker não usa,
-- e podia levar a varredura longa até o statement timeout.
create index if not exists event_log_pending_drain_idx
  on public.event_log (event_type, next_attempt_at, created_at, id)
  where status = 'pending';
