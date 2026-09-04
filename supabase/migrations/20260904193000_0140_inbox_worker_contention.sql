-- 0140_inbox_worker_contention
--
-- O atendimento humano nao pode disputar leitura com analises internas nem
-- recalcular a classificacao de cada conversa duas vezes nas contagens.
-- O SQL Editor do Supabase executa scripts em transacao; por isso os indices
-- abaixo nao usam CONCURRENTLY. Aplique em horario de menor movimento: leituras
-- continuam disponiveis, mas escritas podem aguardar durante a criacao.

-- A analise de qualidade da IA busca as ultimas mensagens por org+contato.
-- Sem este indice ela lia uma parte grande de `messages` em toda rodada.
create index if not exists idx_messages_org_contact_sent_with_body
  on public.messages (organization_id, contact_id, sent_at desc)
  where body is not null;

-- Listas do Inbox sao paginadas por atividade recente ou por tempo de espera.
-- Estes indices evitam ordenar a organizacao inteira antes de entregar a pagina.
create index if not exists idx_conversations_org_last_message
  on public.conversations (organization_id, last_message_at desc, id desc);

create index if not exists idx_conversations_org_last_inbound
  on public.conversations (organization_id, last_inbound_at asc, id asc);

-- Leitura de recibos/nao lidas de uma conversa. O parcial fica pequeno e serve
-- exatamente ao filtro usado no Inbox.
create index if not exists idx_messages_org_conversation_unread_inbound
  on public.messages (organization_id, conversation_id)
  where direction = 'inbound'
    and read_at is null
    and external_id is not null;

-- A versao anterior chamava `conversation_command(c)` duas vezes por linha.
-- Essa funcao faz buscas no contato para cada chamada. Fazemos o join uma vez
-- e preservamos exatamente as mesmas regras de waiting/automatic/finished.
create or replace function public.fn_inbox_counts(p_org uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'u', count(*) filter (
      where c.status not in ('closed', 'archived', 'resolved')
        and (
          coalesce(ct.force_human, false)
          or coalesce(ct.is_blocked, false)
          or c.bot_silenced_until > now()
        )
    ),
    'a', count(*) filter (
      where c.status not in ('closed', 'archived', 'resolved')
        and not coalesce(ct.force_human, false)
        and not coalesce(ct.is_blocked, false)
        and (c.bot_silenced_until is null or c.bot_silenced_until <= now())
    ),
    'm', count(*) filter (
      where c.assigned_to_user_id = auth.uid()
        and c.status not in ('closed', 'archived')
    ),
    't', count(*)
  )
  from public.conversations c
  inner join public.channel_sessions cs on cs.id = c.channel_session_id
  left join public.contacts ct on ct.id = c.contact_id
  where c.organization_id = p_org
    and cs.archived_at is null;
$$;

analyze public.messages;
analyze public.conversations;
