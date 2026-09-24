-- 0145_campaign_reply_audio
-- Permite responder ao primeiro retorno da campanha com texto, áudio ou ambos.

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
        create_lead_before_send = true
        and reply_stage_id is not null
        and (
          reply_response_mode = 'audio'
          or nullif(btrim(reply_message_template), '') is not null
        )
      )
    );

notify pgrst, 'reload schema';
