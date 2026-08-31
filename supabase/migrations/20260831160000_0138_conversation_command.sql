-- Single source of truth for who currently controls an Inbox conversation.
create or replace function public.fn_conversation_command(
  p_status text,
  p_assigned_to_user_id uuid,
  p_bot_silenced_until timestamptz,
  p_force_human boolean,
  p_is_blocked boolean,
  p_now timestamptz
) returns text
language sql
immutable
set search_path = public
as $fn$
  select case
    when p_assigned_to_user_id is not null then 'human'
    when p_status in ('closed', 'archived', 'resolved') then 'finished'
    when p_force_human is true
      or p_is_blocked is true
      or (p_bot_silenced_until is not null and p_bot_silenced_until > p_now) then 'waiting'
    else 'automatic'
  end;
$fn$;

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
    coalesce((select ct.force_human from public.contacts ct where ct.id = c.contact_id), false),
    coalesce((select ct.is_blocked from public.contacts ct where ct.id = c.contact_id), false),
    now()
  );
$fn$;

revoke execute on function public.fn_conversation_command(text, uuid, timestamptz, boolean, boolean, timestamptz) from public, anon;
revoke execute on function public.conversation_command(public.conversations) from public, anon;
grant execute on function public.fn_conversation_command(text, uuid, timestamptz, boolean, boolean, timestamptz) to authenticated, service_role;
grant execute on function public.conversation_command(public.conversations) to authenticated, service_role;

notify pgrst, 'reload schema';
