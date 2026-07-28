-- 0087 — contratos explícitos para integrações de origem (ex.: 3C).
alter table public.webhook_sources
  add column if not exists source_code text not null default 'webhook'
    check (source_code ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  add column if not exists require_external_id boolean not null default false;

comment on column public.webhook_sources.source_code is
  'Origem auditável aplicada ao contato/lead (ex.: 3c); não concede acesso ao banco.';
comment on column public.webhook_sources.require_external_id is
  'Quando true, rejeita eventos sem external_id e torna a integração estritamente idempotente.';
