-- 0139_inbox_counts_aggregation
-- O Inbox atualizava quatro `count: exact` independentes para os filtros do
-- topo. Uma única agregação preserva o mesmo escopo RLS e reduz viagens ao DB.

create or replace function public.fn_inbox_counts(p_org uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'u', count(*) filter (where c.conversation_command = 'waiting'),
    'a', count(*) filter (where c.conversation_command = 'automatic'),
    'm', count(*) filter (
      where c.assigned_to_user_id = auth.uid()
        and c.status not in ('closed', 'archived')
    ),
    't', count(*)
  )
  from public.conversations c
  inner join public.channel_sessions cs on cs.id = c.channel_session_id
  where c.organization_id = p_org
    and cs.archived_at is null;
$$;

revoke all on function public.fn_inbox_counts(uuid) from public;
revoke execute on function public.fn_inbox_counts(uuid) from anon;
grant execute on function public.fn_inbox_counts(uuid) to authenticated, service_role;
