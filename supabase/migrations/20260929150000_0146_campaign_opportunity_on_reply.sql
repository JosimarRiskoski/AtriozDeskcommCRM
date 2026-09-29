-- 0146_campaign_opportunity_on_reply
--
-- Uma campanha pode criar o negocio antes do primeiro envio OU somente quando
-- o contato responder. Os dois modos sao mutuamente exclusivos: criar os dois
-- criaria um card antes da resposta e tornaria a configuracao enganosa.

alter table public.outreach_campaigns
  add column if not exists create_lead_on_reply boolean not null default false;

alter table public.outreach_campaigns
  drop constraint if exists outreach_campaigns_opportunity_config_check;

alter table public.outreach_campaigns
  add constraint outreach_campaigns_opportunity_config_check
  check (
    not (create_lead_before_send and create_lead_on_reply)
    and (
      (not create_lead_before_send and not create_lead_on_reply)
      or (pipeline_id is not null and stage_id is not null)
    )
  );

comment on column public.outreach_campaigns.create_lead_on_reply is
  'Quando verdadeiro, cria ou move a oportunidade somente na primeira resposta inbound do destinatario da campanha.';

notify pgrst, 'reload schema';
