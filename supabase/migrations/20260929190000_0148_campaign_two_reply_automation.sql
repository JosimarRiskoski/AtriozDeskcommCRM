-- Automacao de duas respostas da campanha, adaptada para criacao tardia de oportunidade.
comment on column public.outreach_campaigns.create_lead_on_reply is
  'Cria ou move a oportunidade na primeira resposta sem automacao, ou na segunda resposta quando a automacao de duas respostas estiver ativa.';

-- 0144_campaign_reply_automation
-- Resposta automatica (sem IA) na primeira resposta do destinatario, seguida
-- pela movimentacao segura da oportunidade para uma etapa posterior do Kanban.

alter table public.outreach_campaigns
  add column if not exists reply_automation_enabled boolean not null default false,
  add column if not exists reply_message_template text,
  add column if not exists reply_stage_id uuid references public.crm_stages(id) on delete set null,
  add column if not exists reply_delay_seconds integer not null default 5;

alter table public.outreach_campaigns
  drop constraint if exists outreach_campaigns_reply_delay_check,
  add constraint outreach_campaigns_reply_delay_check
    check (reply_delay_seconds between 0 and 300);

alter table public.outreach_campaigns
  drop constraint if exists outreach_campaigns_reply_automation_config_check,
  add constraint outreach_campaigns_reply_automation_config_check
    check (
      not reply_automation_enabled
      or (
        (create_lead_before_send or create_lead_on_reply)
        and reply_stage_id is not null
        and length(btrim(reply_message_template)) between 1 and 4096
      )
    );

alter table public.outreach_campaign_recipients
  add column if not exists reply_automation_status text not null default 'pending',
  add column if not exists reply_automation_claimed_at timestamptz,
  add column if not exists reply_automation_completed_at timestamptz,
  add column if not exists reply_automation_inbound_message_id uuid references public.messages(id) on delete set null,
  add column if not exists reply_automation_message_sent_at timestamptz,
  add column if not exists reply_automation_attempts integer not null default 0,
  add column if not exists reply_automation_last_error text;

alter table public.outreach_campaign_recipients
  drop constraint if exists outreach_campaign_recipients_reply_automation_status_check,
  add constraint outreach_campaign_recipients_reply_automation_status_check
    check (reply_automation_status in ('pending','processing','completed','failed','skipped'));

create index if not exists idx_outreach_recipients_reply_automation
  on public.outreach_campaign_recipients (organization_id, contact_id, conversation_id, replied_at desc)
  where status = 'replied' and reply_automation_status = 'pending';


alter table public.outreach_campaigns
  add column if not exists reply_response_mode text not null default 'text',
  add column if not exists reply_audio_storage_path text,
  add column if not exists reply_text_audio_gap_seconds integer not null default 2;

alter table public.outreach_campaigns
  drop constraint if exists outreach_campaigns_reply_response_mode_check,
  add constraint outreach_campaigns_reply_response_mode_check
    check (reply_response_mode in ('text','audio','text_audio')),
  drop constraint if exists outreach_campaigns_reply_text_audio_gap_check,
  add constraint outreach_campaigns_reply_text_audio_gap_check
    check (reply_text_audio_gap_seconds between 0 and 30),
  drop constraint if exists outreach_campaigns_reply_automation_config_check,
  add constraint outreach_campaigns_reply_automation_config_check
    check (
      not reply_automation_enabled
      or (
        (create_lead_before_send or create_lead_on_reply)
        and reply_stage_id is not null
        and (
          reply_response_mode = 'audio'
          or nullif(btrim(reply_message_template), '') is not null
        )
      )
    );



-- 0146_campaign_two_reply_qualification
-- A primeira resposta recebe a continuacao automatica. O Kanban so avanca
-- depois de uma segunda resposta do contato, quando o atendimento vira manual.

alter table public.outreach_campaign_recipients
  add column if not exists reply_automation_second_inbound_message_id uuid
    references public.messages(id) on delete set null,
  add column if not exists reply_automation_awaiting_since timestamptz;

alter table public.outreach_campaign_recipients
  drop constraint if exists outreach_campaign_recipients_reply_automation_status_check,
  add constraint outreach_campaign_recipients_reply_automation_status_check
    check (reply_automation_status in (
      'pending','processing','awaiting_second_reply','completed','failed','skipped'
    ));


create index if not exists idx_outreach_recipients_waiting_second_reply
  on public.outreach_campaign_recipients (organization_id, contact_id, conversation_id)
  where status = 'replied' and reply_automation_status = 'awaiting_second_reply';



-- 0147_campaign_reply_exclusivity
-- Uma conversa pode ter historico em varias campanhas, mas somente o
-- destinatario mais recente pode reagir a uma nova mensagem recebida.
-- message.received passa a nascer apenas no trigger da tabela messages.

create or replace function public.fn_mark_campaign_recipient_replied(
  p_org uuid,
  p_contact uuid,
  p_conversation uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid;
begin
  select r.id
    into v_target
    from public.outreach_campaign_recipients r
   where r.organization_id = p_org
     and r.contact_id = p_contact
     and r.conversation_id = p_conversation
     and r.sent_at is not null
   order by r.sent_at desc, r.created_at desc, r.id desc
   limit 1
   for update;

  if v_target is null then return 0; end if;

  update public.outreach_campaign_recipients r
     set status = case
           when r.status in ('processing', 'sent') then 'cancelled'
           else r.status
         end,
         reply_automation_status = case
           when r.reply_automation_status in ('pending', 'processing', 'awaiting_second_reply')
             then 'skipped'
           else r.reply_automation_status
         end,
         reply_automation_last_error = case
           when r.reply_automation_status in ('pending', 'processing', 'awaiting_second_reply')
             then 'Substituida por uma campanha mais recente para esta conversa.'
           else r.reply_automation_last_error
         end,
         processing_lease_until = null,
         updated_at = now()
   where r.organization_id = p_org
     and r.contact_id = p_contact
     and r.conversation_id = p_conversation
     and r.id <> v_target
     and (
       r.status in ('processing', 'sent')
       or (
         r.status = 'replied'
         and r.reply_automation_status in ('pending', 'processing', 'awaiting_second_reply')
       )
     );

  update public.outreach_campaign_recipients r
     set status = 'replied',
         replied_at = now(),
         processing_lease_until = null,
         updated_at = now()
   where r.id = v_target
     and r.organization_id = p_org
     and r.status in ('processing', 'sent');

  if found then return 1; end if;
  return 0;
end;
$$;

revoke all on function public.fn_mark_campaign_recipient_replied(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.fn_mark_campaign_recipient_replied(uuid,uuid,uuid)
  to service_role;

create or replace function public.fn_claim_campaign_reply_step(
  p_org uuid,
  p_recipient uuid,
  p_inbound_message uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step text;
begin
  select case
           when r.reply_automation_status = 'pending'
             and p_inbound_message = (
               select m.id from public.messages m
                where m.organization_id = r.organization_id
                  and m.conversation_id = r.conversation_id
                  and m.direction = 'inbound'
                  and m.created_at >= r.sent_at
                order by m.created_at, m.id limit 1
             ) then 'first_reply'
           when r.reply_automation_status = 'awaiting_second_reply'
             and r.reply_automation_inbound_message_id is distinct from p_inbound_message
             and exists (
               select 1 from public.messages m
                where m.id = p_inbound_message
                  and m.organization_id = r.organization_id
                  and m.conversation_id = r.conversation_id
                  and m.direction = 'inbound'
                  and m.created_at > r.reply_automation_awaiting_since
             )
             then 'second_reply'
         end
    into v_step
    from public.outreach_campaign_recipients r
   where r.id = p_recipient
     and r.organization_id = p_org
     and r.status = 'replied'
     and r.sent_at is not null
     and not exists (
       select 1
         from public.outreach_campaign_recipients newer
        where newer.organization_id = r.organization_id
          and newer.contact_id = r.contact_id
          and newer.conversation_id = r.conversation_id
          and newer.id <> r.id
          and newer.sent_at is not null
          and (
            newer.sent_at, newer.created_at, newer.id
          ) > (
            r.sent_at, r.created_at, r.id
          )
     )
     and exists (
       select 1
         from public.outreach_campaigns c
        where c.id = r.campaign_id
          and c.organization_id = r.organization_id
          and c.reply_automation_enabled = true
     )
   for update;

  if v_step is null then return null; end if;

  update public.outreach_campaign_recipients
     set reply_automation_status = 'processing',
         reply_automation_claimed_at = now(),
         reply_automation_inbound_message_id = case
           when v_step = 'first_reply' then p_inbound_message
           else reply_automation_inbound_message_id
         end,
         reply_automation_second_inbound_message_id = case
           when v_step = 'second_reply' then p_inbound_message
           else reply_automation_second_inbound_message_id
         end,
         reply_automation_attempts = reply_automation_attempts + 1,
         reply_automation_last_error = null,
         updated_at = now()
   where id = p_recipient and organization_id = p_org;

  return v_step;
end;
$$;

revoke all on function public.fn_claim_campaign_reply_step(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.fn_claim_campaign_reply_step(uuid,uuid,uuid)
  to service_role;




-- A antiga segunda mensagem por ausencia de resposta fica desativada.
update public.outreach_campaigns set followup_text_template = null where followup_text_template is not null;

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
       or (r.status='processing' and coalesce(r.processing_lease_until,'-infinity'::timestamptz)<now()))
   order by coalesce(c.next_dispatch_at,c.scheduled_for,c.created_at),
     r.created_at, r.position
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
notify pgrst, 'reload schema';
