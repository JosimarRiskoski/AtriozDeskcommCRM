-- Impede novas oportunidades abertas duplicadas sem invalidar dados antigos.
--
-- Um índice UNIQUE parcial falharia ao instalar a migration se a organização
-- já tivesse duplicidades históricas. O trigger abaixo preserva essas linhas,
-- permite editar uma oportunidade já aberta e rejeita somente uma nova
-- duplicidade. O advisory lock fecha a corrida entre duas criações simultâneas.

drop index if exists public.uniq_crm_leads_one_open_per_contact;

create or replace function public.fn_reject_duplicate_open_crm_lead()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status <> 'open' or new.contact_id is null then
    return new;
  end if;

  -- Alterações comuns na própria oportunidade aberta continuam permitidas,
  -- inclusive quando existem duplicidades legadas a serem revisadas depois.
  if tg_op = 'UPDATE'
     and old.status = 'open'
     and old.organization_id = new.organization_id
     and old.contact_id = new.contact_id then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.organization_id::text || ':' || new.contact_id::text, 0)
  );

  if exists (
    select 1
      from public.crm_leads lead
     where lead.organization_id = new.organization_id
       and lead.contact_id = new.contact_id
       and lead.status = 'open'
       and lead.id is distinct from new.id
  ) then
    raise exception 'Já existe uma oportunidade aberta para este contato.'
      using
        errcode = '23505',
        constraint = 'uniq_crm_leads_one_open_per_contact';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reject_duplicate_open_crm_lead on public.crm_leads;
create trigger trg_reject_duplicate_open_crm_lead
before insert or update of organization_id, contact_id, status
on public.crm_leads
for each row
execute function public.fn_reject_duplicate_open_crm_lead();

comment on function public.fn_reject_duplicate_open_crm_lead() is
  'Preserva duplicidades legadas e impede novas oportunidades abertas para o mesmo contato.';
