-- The Inbox computed field is evaluated once per candidate conversation.
-- Read both contact flags in one lookup instead of two correlated subqueries.
-- Keep SECURITY INVOKER so the contacts RLS policy remains in effect.
create or replace function public.conversation_command(c public.conversations)
returns text
language sql
stable
set search_path = public
as $fn$
  select public.fn_conversation_command(
    c.status,
    c.assigned_to_user_id,
    c.bot_silenced_until,
    coalesce(ct.force_human, false),
    coalesce(ct.is_blocked, false),
    now()
  )
  from (select 1) as one_row
  left join public.contacts ct on ct.id = c.contact_id;
$fn$;

revoke execute on function public.conversation_command(public.conversations) from public, anon;
grant execute on function public.conversation_command(public.conversations) to authenticated, service_role;

notify pgrst, 'reload schema';
