-- 0085 — campanhas sequenciais protegidas e retomáveis.
-- O envio é deliberadamente unitário: um destinatário por claim, com janela
-- mínima entre contatos. Nenhuma lista é enviada diretamente pelo navegador.

create table if not exists public.outreach_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_session_id uuid not null references public.channel_sessions(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 120),
  status text not null default 'draft' check (status in ('draft','scheduled','running','paused','cancelled','completed')),
  text_template text not null check (length(btrim(text_template)) between 1 and 4096),
  audio_storage_path text,
  delay_before_audio_seconds integer not null default 2 check (delay_before_audio_seconds between 0 and 60),
  interval_seconds integer not null default 300 check (interval_seconds between 60 and 86400),
  timezone text not null default 'America/Sao_Paulo',
  business_hour_start time not null default '08:00',
  business_hour_end time not null default '18:00',
  create_lead_before_send boolean not null default true,
  ai_mode text not null default 'paused' check (ai_mode in ('paused','inherit','active')),
  source_kind text not null default 'csv' check (source_kind in ('csv','google_sheets','manual')),
  source_metadata jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz,
  next_dispatch_at timestamptz,
  created_by_user_id uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (business_hour_start < business_hour_end)
);

create table if not exists public.outreach_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  position integer not null check (position >= 0),
  phone_normalized text not null check (phone_normalized ~ '^[1-9][0-9]{9,14}$'),
  name text,
  email text,
  consent_confirmed boolean not null default false,
  consent_source text,
  contact_id uuid references public.contacts(id) on delete set null,
  lead_id uuid references public.crm_leads(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','processing','sent','replied','skipped','failed','cancelled')),
  scheduled_at timestamptz,
  claimed_at timestamptz,
  sent_at timestamptz,
  replied_at timestamptz,
  last_error_code text,
  last_error_message text,
  attempts integer not null default 0 check (attempts between 0 and 10),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, phone_normalized),
  unique (organization_id, idempotency_key)
);

create index if not exists idx_outreach_campaigns_due
  on public.outreach_campaigns (next_dispatch_at)
  where status in ('scheduled','running');
create index if not exists idx_outreach_recipients_pending
  on public.outreach_campaign_recipients (campaign_id, position)
  where status = 'pending';
create index if not exists idx_outreach_recipients_contact
  on public.outreach_campaign_recipients (organization_id, contact_id);

alter table public.outreach_campaigns enable row level security;
alter table public.outreach_campaign_recipients enable row level security;

drop policy if exists outreach_campaigns_read on public.outreach_campaigns;
create policy outreach_campaigns_read on public.outreach_campaigns for select
  using (exists (
    select 1 from public.user_organizations uo
     where uo.organization_id = outreach_campaigns.organization_id
       and uo.user_id = auth.uid() and uo.revoked_at is null
  ));
drop policy if exists outreach_campaigns_write on public.outreach_campaigns;
create policy outreach_campaigns_write on public.outreach_campaigns for all
  using (exists (
    select 1 from public.user_organizations uo
     where uo.organization_id = outreach_campaigns.organization_id
       and uo.user_id = auth.uid() and uo.revoked_at is null
       and uo.role in ('manager','admin')
  ))
  with check (exists (
    select 1 from public.user_organizations uo
     where uo.organization_id = outreach_campaigns.organization_id
       and uo.user_id = auth.uid() and uo.revoked_at is null
       and uo.role in ('manager','admin')
  ));

drop policy if exists outreach_recipients_read on public.outreach_campaign_recipients;
create policy outreach_recipients_read on public.outreach_campaign_recipients for select
  using (exists (
    select 1 from public.user_organizations uo
     where uo.organization_id = outreach_campaign_recipients.organization_id
       and uo.user_id = auth.uid() and uo.revoked_at is null
  ));
drop policy if exists outreach_recipients_write on public.outreach_campaign_recipients;
create policy outreach_recipients_write on public.outreach_campaign_recipients for all
  using (exists (
    select 1 from public.user_organizations uo
     where uo.organization_id = outreach_campaign_recipients.organization_id
       and uo.user_id = auth.uid() and uo.revoked_at is null
       and uo.role in ('manager','admin')
  ))
  with check (exists (
    select 1 from public.user_organizations uo
     where uo.organization_id = outreach_campaign_recipients.organization_id
       and uo.user_id = auth.uid() and uo.revoked_at is null
       and uo.role in ('manager','admin')
  ));

comment on table public.outreach_campaigns is
  'Campanhas WhatsApp sequenciais, pausáveis e retomáveis; intervalo padrão 5 minutos.';
comment on column public.outreach_campaign_recipients.consent_confirmed is
  'Precisa ser true antes do destinatário tornar-se elegível para envio.';
