-- Structured commercial profile shared by humans and approved AI tools.
alter table public.contacts
  add column if not exists company text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

alter table public.contacts
  drop constraint if exists contacts_state_format;
alter table public.contacts
  add constraint contacts_state_format check (state is null or state ~ '^[A-Z]{2}$');
alter table public.contacts
  drop constraint if exists contacts_custom_fields_object;
alter table public.contacts
  add constraint contacts_custom_fields_object check (jsonb_typeof(custom_fields)='object');

comment on column public.contacts.company is 'Empresa informada pelo contato; editável por humano ou ferramenta restrita da IA.';
comment on column public.contacts.city is 'Cidade confirmada pelo contato.';
comment on column public.contacts.state is 'UF brasileira em duas letras maiúsculas.';
comment on column public.contacts.custom_fields is 'Campos comerciais adicionais; não armazena consentimento, CPF, segredos ou controles administrativos.';
