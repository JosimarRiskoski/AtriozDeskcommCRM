-- 0130_compact_persisted_message_media
-- Mídia já salva no bucket privado não precisa manter uma segunda cópia base64
-- na linha da mensagem nem a estrutura crua usada somente para recuperá-la.

set lock_timeout = '5s';
set statement_timeout = '60s';

update public.messages
set media_url = null,
    metadata = coalesce(metadata, '{}'::jsonb) - 'evolution_message'
where media_storage_path is not null
  and media_url like 'data:%';
