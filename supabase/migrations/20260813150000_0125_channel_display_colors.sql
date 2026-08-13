-- 0125_channel_display_colors
-- Identidade visual persistente para diferenciar conexoes no Inbox sem usar
-- apenas o nome ou os quatro ultimos digitos do telefone.

alter table public.channel_sessions
  add column if not exists display_color text;

with ranked as (
  select
    id,
    row_number() over (partition by organization_id order by created_at, id) as position
  from public.channel_sessions
  where display_color is null
)
update public.channel_sessions session
set display_color = case ((ranked.position - 1) % 8)
  when 0 then '#3B82F6'
  when 1 then '#A855F7'
  when 2 then '#10B981'
  when 3 then '#F59E0B'
  when 4 then '#EF4444'
  when 5 then '#06B6D4'
  when 6 then '#EC4899'
  else '#64748B'
end
from ranked
where session.id = ranked.id;

alter table public.channel_sessions
  alter column display_color set default '#3B82F6',
  alter column display_color set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.channel_sessions'::regclass
      and conname = 'channel_sessions_display_color_check'
  ) then
    alter table public.channel_sessions
      add constraint channel_sessions_display_color_check
      check (display_color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end $$;

comment on column public.channel_sessions.display_color is
  'Cor hexadecimal escolhida pela organizacao para identificar esta conexao no Inbox.';
