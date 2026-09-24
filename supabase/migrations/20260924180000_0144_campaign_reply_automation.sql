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
        create_lead_before_send
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

create or replace function public.fn_claim_campaign_reply_automation(
  p_org uuid,
  p_recipient uuid,
  p_inbound_message uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  update public.outreach_campaign_recipients r
     set reply_automation_status = 'processing',
         reply_automation_claimed_at = now(),
         reply_automation_inbound_message_id = p_inbound_message,
         reply_automation_attempts = reply_automation_attempts + 1,
         reply_automation_last_error = null,
         updated_at = now()
   where r.id = p_recipient
     and r.organization_id = p_org
     and r.status = 'replied'
     and r.reply_automation_status = 'pending'
     and exists (
       select 1
         from public.outreach_campaigns c
        where c.id = r.campaign_id
          and c.organization_id = r.organization_id
          and c.reply_automation_enabled = true
     );
  v_claimed := found;
  return v_claimed;
end;
$$;

revoke all on function public.fn_claim_campaign_reply_automation(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.fn_claim_campaign_reply_automation(uuid,uuid,uuid)
  to service_role;

notify pgrst, 'reload schema';
