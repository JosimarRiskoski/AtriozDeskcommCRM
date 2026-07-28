-- 0094_interactive_poll_templates
-- Polls are supported by every WAHA engine and are the stable interactive fallback.
alter table public.message_templates
  add column if not exists kind text not null default 'text',
  add column if not exists interactive_config jsonb;

alter table public.message_templates
  drop constraint if exists message_templates_kind_check;
alter table public.message_templates
  add constraint message_templates_kind_check check (kind in ('text', 'poll'));

alter table public.message_templates
  drop constraint if exists message_templates_interactive_config_check;
alter table public.message_templates
  add constraint message_templates_interactive_config_check check (
    (kind = 'text' and interactive_config is null)
    or
    (kind = 'poll' and jsonb_typeof(interactive_config->'options') = 'array')
  );
