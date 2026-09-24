-- 0145_optimize_inbox_counts
--
-- `conversation_command(c)` consultava contacts para cada conversa e era
-- avaliada uma vez para a Fila e outra para Automatico. Mantemos exatamente a
-- precedencia canonica (human > finished > waiting > automatic), mas fazemos
-- um unico join com contacts e agregamos os quatro contadores em uma passagem.
--
-- SECURITY INVOKER continua sendo o default: a RLS de conversations,
-- channel_sessions e contacts permanece aplicada ao usuario autenticado.

create or replace function public.fn_inbox_counts(p_org uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'u', count(*) filter (
      where c.assigned_to_user_id is null
        and c.status not in ('closed', 'archived', 'resolved')
        and (
          coalesce(ct.force_human, false)
          or coalesce(ct.is_blocked, false)
          or c.bot_silenced_until > now()
        )
    ),
    'a', count(*) filter (
      where c.assigned_to_user_id is null
        and c.status not in ('closed', 'archived', 'resolved')
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

revoke all on function public.fn_inbox_counts(uuid) from public;
revoke execute on function public.fn_inbox_counts(uuid) from anon;
grant execute on function public.fn_inbox_counts(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
