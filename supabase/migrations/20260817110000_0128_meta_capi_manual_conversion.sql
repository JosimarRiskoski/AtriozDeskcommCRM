-- 0128_meta_capi_manual_conversion
-- A conversao para a Meta passa a exigir confirmacao humana explicita.

drop trigger if exists trg_enqueue_meta_conversion_on_won on public.crm_leads;
drop function if exists public.fn_enqueue_meta_conversion_on_won();

alter table public.meta_capi_settings
  add column if not exists conversion_label text not null default 'Venda fechada';

alter table public.meta_conversion_events
  add column if not exists requested_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists requested_at timestamptz,
  add column if not exists conversion_label text,
  add column if not exists request_summary jsonb not null default '{}'::jsonb;

-- Eventos ainda na fila, criados pelo gatilho antigo, nao podem sair sem um
-- novo clique humano. O mesmo registro podera ser reativado manualmente.
update public.meta_conversion_events
set status = 'skipped',
    lease_until = null,
    last_error = 'automatic_trigger_disabled_before_manual_confirmation',
    updated_at = now()
where status in ('pending', 'processing')
  and requested_by_user_id is null;

-- Se uma base de teste antiga tiver mais de um sucesso para a mesma
-- oportunidade, preserva o mais recente como oficial e mantém o payload dos
-- anteriores para auditoria, mas sem tratá-los como novo sucesso.
with ranked_sent as (
  select id,
         row_number() over (
           partition by organization_id, lead_id
           order by sent_at desc nulls last, created_at desc, id desc
         ) as position
  from public.meta_conversion_events
  where status = 'sent'
)
update public.meta_conversion_events event
set status = 'skipped',
    last_error = 'historical_duplicate_superseded',
    updated_at = now()
from ranked_sent ranked
where event.id = ranked.id
  and ranked.position > 1;

create unique index if not exists uniq_meta_conversion_one_success_per_lead
  on public.meta_conversion_events(organization_id, lead_id)
  where status = 'sent';

create index if not exists idx_meta_conversion_lead
  on public.meta_conversion_events(organization_id, lead_id, created_at desc);

comment on table public.meta_conversion_events is
  'Conversoes CRM enviadas manualmente para a Meta. Mudancas de etapa nunca enfileiram eventos.';
comment on column public.meta_conversion_events.requested_by_user_id is
  'Usuario que confirmou explicitamente o envio manual.';
comment on column public.meta_conversion_events.request_summary is
  'Resumo auditavel sem token e sem PII em texto puro.';
comment on column public.meta_capi_settings.conversion_label is
  'Nome amigavel do marco comercial exibido antes da confirmacao manual.';

-- O modelo de origem ja e JSON e nao precisa de outra tabela. Padronizamos as
-- chaves que integracoes de formulario/Meta podem preservar quando existirem.
comment on column public.contacts.source_metadata is
  'Metadados estruturados de origem. Para Meta, preservar fbc, fbp e meta_lead_id quando recebidos; nunca fabricar valores.';
