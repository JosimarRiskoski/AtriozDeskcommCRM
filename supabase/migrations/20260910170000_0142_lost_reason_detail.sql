-- O código canônico continua em lost_reason; o texto livre é armazenado
-- separadamente para não violar o trigger de motivos permitidos.
alter table public.crm_leads
  add column if not exists lost_reason_detail text;

alter table public.crm_leads
  drop constraint if exists crm_leads_lost_reason_detail_length;

alter table public.crm_leads
  add constraint crm_leads_lost_reason_detail_length
  check (lost_reason_detail is null or char_length(lost_reason_detail) between 1 and 500);
