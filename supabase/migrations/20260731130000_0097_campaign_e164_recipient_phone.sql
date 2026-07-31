-- 0097 — destinatários de campanha aceitam o mesmo E.164 produzido pelo importador.
-- normalizePhoneBR() retorna "+55..."; a restrição original de 0085 aceitava
-- somente dígitos e fazia o cadastro inteiro da campanha entrar em rollback.

alter table public.outreach_campaign_recipients
  drop constraint if exists outreach_campaign_recipients_phone_normalized_check;

alter table public.outreach_campaign_recipients
  add constraint outreach_campaign_recipients_phone_normalized_check
  check (phone_normalized ~ '^\+?[1-9][0-9]{7,14}$');

comment on column public.outreach_campaign_recipients.phone_normalized is
  'Telefone E.164 do destinatário; aceita + opcional para compatibilidade, e novas importações usam +.';
