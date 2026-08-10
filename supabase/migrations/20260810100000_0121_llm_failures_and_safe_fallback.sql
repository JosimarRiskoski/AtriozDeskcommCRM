-- Registra falhas do provedor de IA e substitui somente o fallback antigo que
-- prometia handoff sem criar um caso. Mudança aditiva e idempotente.
alter table public.llm_calls add column if not exists status text not null default 'ok';
alter table public.llm_calls add column if not exists error_code text;
alter table public.llm_calls add column if not exists error_message text;
alter table public.llm_calls add column if not exists http_status int;
alter table public.llm_calls add column if not exists origem_da_escolha text;

update public.llm_calls set status = 'ok' where status is null or status not in ('ok', 'erro');

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'llm_calls_status_check') then
    alter table public.llm_calls
      add constraint llm_calls_status_check check (status in ('ok', 'erro'));
  end if;
end $$;

create index if not exists llm_calls_erros_idx
  on public.llm_calls (organization_id, created_at desc) where status = 'erro';
create index if not exists llm_calls_purpose_idx
  on public.llm_calls (organization_id, purpose, created_at desc);

update public.ai_agents
set config = jsonb_set(
  coalesce(config, '{}'::jsonb),
  '{fallback_message}',
  to_jsonb('Não encontrei essa informação nas fontes autorizadas. Pode detalhar um pouco mais a sua dúvida?'::text),
  true
)
where trim(coalesce(config->>'fallback_message', '')) in (
  'Não encontrei essa informação na base autorizada. Vou encaminhar para uma pessoa.',
  'Não encontrei essa informação na base autorizada. Vou encaminhar o atendimento para uma pessoa.'
);

comment on column public.llm_calls.status is
  '0121: ok ou erro. Falhas do provedor deixam rastro sem armazenar prompt ou resposta.';
comment on column public.llm_calls.error_message is
  '0121: mensagem técnica redigida e truncada; nunca deve conter prompt, resposta ou chave.';
comment on column public.llm_calls.origem_da_escolha is
  '0121: origem da seleção do modelo, como agente_publicado ou padrao_da_organizacao.';
