-- 0131_finish_compacting_persisted_media
-- A 0130 limpava apenas linhas cuja media_url ainda era um data URL. Algumas
-- mensagens já tinham media_url nula, mas preservavam a mensagem crua da
-- Evolution mesmo depois do arquivo estar seguro no bucket privado.

set lock_timeout = '5s';
set statement_timeout = '60s';

update public.messages
set media_url = case when media_url like 'data:%' then null else media_url end,
    metadata = coalesce(metadata, '{}'::jsonb) - 'evolution_message'
where media_storage_path is not null
  and ((metadata ? 'evolution_message') or media_url like 'data:%');
