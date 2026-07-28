-- 0092 — convites de equipe persistentes, auditáveis, reenviáveis e canceláveis.

create table if not exists public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('viewer','agent','manager','admin')),
  status text not null default 'pending' check (status in ('pending','accepted','cancelled','failed')),
  invited_by uuid references auth.users(id) on delete set null,
  accepted_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  email_dispatched boolean not null default false,
  provider_message_id text,
  last_error text,
  last_sent_at timestamptz,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_team_invitations_pending_email
  on public.team_invitations(organization_id, lower(email))
  where status = 'pending';
create index if not exists idx_team_invitations_org_created
  on public.team_invitations(organization_id, created_at desc);

alter table public.team_invitations enable row level security;

create policy team_invitations_admin_read on public.team_invitations for select
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );

create policy team_invitations_admin_write on public.team_invitations for all
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );

comment on table public.team_invitations is
  'Convites de equipe persistentes. Links continuam assinados por HMAC; esta tabela controla validade, cancelamento e aceite único.';
