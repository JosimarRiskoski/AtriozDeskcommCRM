-- Segunda mensagem de campanha: somente após a primeira e nunca após resposta.

alter table public.outreach_campaigns
  add column if not exists followup_text_template text,
  add column if not exists followup_delay_seconds integer not null default 86400;

alter table public.outreach_campaigns
  drop constraint if exists outreach_campaigns_followup_config_check;

alter table public.outreach_campaigns
  add constraint outreach_campaigns_followup_config_check
  check (
    (followup_text_template is null and followup_delay_seconds between 60 and 2592000)
    or (length(btrim(followup_text_template)) between 1 and 4096 and followup_delay_seconds between 60 and 2592000)
  );

alter table public.outreach_campaign_recipients
  add column if not exists followup_due_at timestamptz,
  add column if not exists followup_sent_at timestamptz;

create index if not exists idx_outreach_recipients_followup_due
  on public.outreach_campaign_recipients (followup_due_at)
  where status = 'sent' and followup_sent_at is null;

-- A assinatura retorna novos campos para o worker; PostgreSQL exige recriar a função.
drop function if exists public.fn_claim_due_outreach_recipient(integer);

create or replace function public.fn_claim_due_outreach_recipient(p_lease_seconds integer default 180)
returns table (
  recipient_id uuid, campaign_id uuid, organization_id uuid, conversation_id uuid,
  created_by_user_id uuid, recipient_name text, phone_normalized text,
  text_template text, followup_text_template text, followup_delay_seconds integer,
  audio_storage_path text, delay_before_audio_seconds integer, interval_seconds integer,
  campaign_timezone text, business_hour_start time, business_hour_end time,
  text_sent_at timestamptz, audio_sent_at timestamptz, followup_sent_at timestamptz
)
language plpgsql security definer set search_path=public as $$
declare v_recipient public.outreach_campaign_recipients%rowtype;
begin
  select r.* into v_recipient
    from public.outreach_campaign_recipients r
    join public.outreach_campaigns c on c.id=r.campaign_id
    join public.channel_sessions s on s.id=r.channel_session_id and s.organization_id=r.organization_id
   where c.status in ('scheduled','running') and s.status='WORKING'
     and coalesce(c.scheduled_for,now())<=now() and coalesce(c.next_dispatch_at,now())<=now()
     and r.consent_confirmed=true and r.conversation_id is not null
     and (
       r.status='pending'
       or (r.status='processing' and coalesce(r.processing_lease_until,'-infinity'::timestamptz)<now())
       or (
         r.status='sent' and r.replied_at is null and r.followup_sent_at is null
         and c.followup_text_template is not null and r.followup_due_at <= now()
       )
     )
   order by coalesce(c.next_dispatch_at,c.scheduled_for,c.created_at),
     case when r.status='sent' then r.followup_due_at else r.created_at end, r.position
   for update of r skip locked limit 1;
  if v_recipient.id is null then return; end if;

  update public.outreach_campaign_recipients set status='processing',claimed_at=now(),
    processing_lease_until=now()+make_interval(secs=>greatest(30,least(p_lease_seconds,900))),
    attempts=attempts+1,updated_at=now() where id=v_recipient.id;
  update public.outreach_campaigns set status='running',started_at=coalesce(started_at,now()),updated_at=now()
    where id=v_recipient.campaign_id;

  return query select r.id,c.id,c.organization_id,r.conversation_id,c.created_by_user_id,
    r.name,r.phone_normalized,c.text_template,c.followup_text_template,c.followup_delay_seconds,
    c.audio_storage_path,c.delay_before_audio_seconds,c.interval_seconds,c.timezone,
    c.business_hour_start,c.business_hour_end,r.text_sent_at,r.audio_sent_at,r.followup_sent_at
    from public.outreach_campaign_recipients r join public.outreach_campaigns c on c.id=r.campaign_id
    where r.id=v_recipient.id;
end $$;

-- Uma resposta cancela a segunda mensagem mesmo se o worker estiver aguardando a execução.
create or replace function public.fn_mark_campaign_recipient_replied(p_org uuid,p_contact uuid,p_conversation uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  update public.outreach_campaign_recipients set status='replied',replied_at=now(),processing_lease_until=null,updated_at=now()
   where organization_id=p_org and contact_id=p_contact and conversation_id=p_conversation
     and status in ('processing','sent');
  get diagnostics v_count = row_count; return v_count;
end $$;

revoke all on function public.fn_claim_due_outreach_recipient(integer) from public,anon,authenticated;
grant execute on function public.fn_claim_due_outreach_recipient(integer) to service_role;
revoke all on function public.fn_mark_campaign_recipient_replied(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.fn_mark_campaign_recipient_replied(uuid,uuid,uuid) to service_role;

notify pgrst, 'reload schema';
