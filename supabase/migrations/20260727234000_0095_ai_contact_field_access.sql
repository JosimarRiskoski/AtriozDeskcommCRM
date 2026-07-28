-- Per-agent, per-field access for commercial contact data.
alter table public.ai_agent_versions
  add column if not exists contact_field_access jsonb not null default '{
    "name":"write",
    "email":"write",
    "phone_number":"write",
    "company":"write",
    "city":"write",
    "state":"write",
    "tags":"write",
    "custom_fields":"write",
    "notes":"write"
  }'::jsonb;

alter table public.ai_agent_versions
  drop constraint if exists ai_agent_versions_contact_field_access_check;
alter table public.ai_agent_versions
  add constraint ai_agent_versions_contact_field_access_check check (
    jsonb_typeof(contact_field_access) = 'object'
    and contact_field_access - array[
      'name','email','phone_number','company','city','state','tags','custom_fields','notes'
    ] = '{}'::jsonb
    and not jsonb_path_exists(
      contact_field_access,
      '$.* ? (@ != "none" && @ != "read" && @ != "write")'
    )
  );

comment on column public.ai_agent_versions.contact_field_access is
  'Field-level commercial contact permissions for this immutable agent version: none, read or write.';
