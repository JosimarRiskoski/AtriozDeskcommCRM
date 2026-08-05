-- 0114 — camada de provedor WhatsApp (Evolution)
--
-- Preserva as sessões e o histórico WAHA existentes enquanto permite que cada
-- conexão passe a apontar para a Evolution. Nenhuma mensagem, contato ou
-- conversa é removida por esta migration.

alter table public.channel_sessions
  add column if not exists provider text not null default 'waha',
  add column if not exists external_session_name text,
  add column if not exists last_inbound_event_at timestamptz,
  add column if not exists last_outbound_event_at timestamptz;

update public.channel_sessions
set external_session_name = waha_session_name
where external_session_name is null or btrim(external_session_name) = '';

alter table public.channel_sessions
  alter column external_session_name set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'channel_sessions_provider_check'
  ) then
    alter table public.channel_sessions
      add constraint channel_sessions_provider_check
      check (provider in ('waha', 'evolution'));
  end if;
end $$;

create unique index if not exists uniq_channel_sessions_provider_external
  on public.channel_sessions (organization_id, provider, external_session_name)
  where archived_at is null;

comment on column public.channel_sessions.provider is
  'Provedor de transporte WhatsApp da sessão: waha (legado) ou evolution.';
comment on column public.channel_sessions.external_session_name is
  'Identificador da sessão/instância no provedor ativo. Não usar diretamente como nome WAHA.';
comment on column public.channel_sessions.last_inbound_event_at is
  'Último evento de entrada aceito pelo CRM; usado para detectar sessão que envia mas não recebe.';
comment on column public.channel_sessions.last_outbound_event_at is
  'Último evento de saída confirmado pelo provedor; usado para saúde real da sessão.';

