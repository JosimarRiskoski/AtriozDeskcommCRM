-- 0129_bound_lid_recovery_and_audit_growth
-- Interrompe o loop que reprocessava as mesmas mensagens @lid a cada minuto,
-- preservando a recuperacao quando a Evolution finalmente revelar o telefone.

alter table public.whatsapp_inbound_pending
  add column if not exists next_attempt_at timestamptz,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists exhausted_at timestamptz;

update public.whatsapp_inbound_pending
set next_attempt_at = coalesce(next_attempt_at, updated_at, created_at, now());

alter table public.whatsapp_inbound_pending
  alter column next_attempt_at set default now();

alter table public.whatsapp_inbound_pending
  drop constraint if exists whatsapp_inbound_pending_status_check;

alter table public.whatsapp_inbound_pending
  add constraint whatsapp_inbound_pending_status_check
  check (status in ('pending', 'reconciling', 'reconciled', 'failed', 'exhausted'));

update public.whatsapp_inbound_pending
set status = 'failed',
    last_error = 'tentativa interrompida; reagendada pela migracao 0129',
    next_attempt_at = now(),
    updated_at = now()
where status = 'reconciling';

update public.whatsapp_inbound_pending
set status = 'exhausted',
    exhausted_at = coalesce(exhausted_at, now()),
    last_error = 'limite antigo de tentativas atingido; aguarda novo vinculo LID -> telefone',
    updated_at = now()
where status in ('pending', 'failed')
  and attempts >= 8;

drop index if exists public.idx_whatsapp_inbound_pending_reconcile;
create index idx_whatsapp_inbound_pending_reconcile
  on public.whatsapp_inbound_pending (next_attempt_at, created_at)
  where status in ('pending', 'failed') and attempts < 8;

-- O defeito gravou uma linha por tentativa. Mantemos exatamente a primeira
-- evidencia de cada mensagem/conexao e removemos apenas as repeticoes.
with ranked as (
  select
    id,
    row_number() over (
      partition by
        organization_id,
        action,
        coalesce(metadata ->> 'channel_session_id', ''),
        coalesce(metadata ->> 'external_id', '')
      order by created_at, id
    ) as occurrence
  from public.api_audit_log
  where action = 'message.identity_pending'
)
delete from public.api_audit_log audit_row
using ranked duplicate_row
where audit_row.id = duplicate_row.id
  and duplicate_row.occurrence > 1;

analyze public.whatsapp_inbound_pending;
analyze public.api_audit_log;

comment on column public.whatsapp_inbound_pending.next_attempt_at is
  'Proxima tentativa do recuperador LID, com backoff exponencial.';
comment on column public.whatsapp_inbound_pending.exhausted_at is
  'Tentativas automaticas encerradas; uma nova mensagem com telefone resolvido ainda reconcilia a linha.';
