import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export interface ReactivationLive {
  lead_id: string;
  lead_title: string;
  contact_id: string | null;
  contact_name: string;
  pipeline_id: string;
  proposal_id: string | null;
  expires_at: string | null;
  lost_since: string | null;
  last_interaction_at: string | null;
  eligibility_reason: string;
  eligible: boolean;
  excluded_reason: string | null;
  suggested_flow_id: string | null;
  suggested_flow_name: string | null;
  generated_alert: boolean;
}

type LeadRow = {
  id: string;
  title: string;
  contact_id: string | null;
  pipeline_id: string;
  status: string;
  closed_at: string | null;
  last_activity_at: string | null;
  created_at: string;
};

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const guard = await requireRole("viewer", { requestId });
  if (!guard.ok) return guard.response;

  const supabase = await createClient();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [proposalsResult, lostResult, flowResult] = await Promise.all([
    supabase
      .from("crm_lead_reactivations")
      .select("id,lead_id,expires_at")
      .eq("organization_id", guard.org.orgId)
      .eq("status", "pending")
      .order("expires_at", { ascending: true }),
    supabase
      .from("crm_leads")
      .select("id,title,contact_id,pipeline_id,status,closed_at,last_activity_at,created_at")
      .eq("organization_id", guard.org.orgId)
      .eq("status", "lost")
      .lte("closed_at", cutoff)
      .order("closed_at", { ascending: true })
      .limit(500),
    supabase
      .from("followup_flow_pointers")
      .select("id,name")
      .eq("organization_id", guard.org.orgId)
      .eq("status", "active")
      .not("active_version_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (proposalsResult.error || lostResult.error) {
    return fail("internal_error", "Não foi possível carregar as reativações.", 500, { requestId });
  }

  const proposals = (proposalsResult.data ?? []) as Array<{
    id: string;
    lead_id: string;
    expires_at: string;
  }>;
  const lost = (lostResult.data ?? []) as LeadRow[];
  const proposalLeadIds = proposals.map((item) => item.lead_id);
  const missingLeadIds = proposalLeadIds.filter((id) => !lost.some((lead) => lead.id === id));
  let proposalLeads: LeadRow[] = [];
  if (missingLeadIds.length > 0) {
    const { data } = await supabase
      .from("crm_leads")
      .select("id,title,contact_id,pipeline_id,status,closed_at,last_activity_at,created_at")
      .eq("organization_id", guard.org.orgId)
      .in("id", missingLeadIds);
    proposalLeads = (data ?? []) as LeadRow[];
  }

  const leads = [...lost, ...proposalLeads];
  const contactIds = [...new Set(leads.map((lead) => lead.contact_id).filter(Boolean))] as string[];
  const [contactsResult, liveResult] = contactIds.length
    ? await Promise.all([
        supabase
          .from("contacts")
          .select("id,name,display_name,phone_number,is_blocked,is_anonymized")
          .eq("organization_id", guard.org.orgId)
          .in("id", contactIds),
        supabase
          .from("followup_enrollments")
          .select("contact_id")
          .eq("organization_id", guard.org.orgId)
          .in("contact_id", contactIds)
          .in("status", ["active", "waiting_reply", "paused_handoff"]),
      ])
    : [{ data: [] }, { data: [] }];
  const contacts = new Map(
    (contactsResult.data ?? []).map((contact) => [contact.id, contact] as const),
  );
  const liveContacts = new Set((liveResult.data ?? []).map((item) => item.contact_id));
  const proposalByLead = new Map(proposals.map((proposal) => [proposal.lead_id, proposal]));
  const suggestedFlow = flowResult.data as { id: string; name: string } | null;

  const items: ReactivationLive[] = leads.map((lead) => {
    const contact = lead.contact_id ? contacts.get(lead.contact_id) : null;
    const proposal = proposalByLead.get(lead.id) ?? null;
    let excludedReason: string | null = null;
    if (!lead.contact_id || !contact) excludedReason = "Sem contato vinculado";
    else if (contact.is_blocked) excludedReason = "Excluído — bloqueio total";
    else if (contact.is_anonymized) excludedReason = "Contato anonimizado";
    else if (!contact.phone_number) excludedReason = "Telefone inválido ou ausente";
    else if (liveContacts.has(lead.contact_id)) excludedReason = "Já possui follow-up ativo";
    else if (!suggestedFlow && !proposal) excludedReason = "Nenhum fluxo publicado";

    return {
      lead_id: lead.id,
      lead_title: lead.title,
      contact_id: lead.contact_id,
      contact_name:
        contact?.display_name ||
        contact?.name ||
        contact?.phone_number ||
        "Contato não identificado",
      pipeline_id: lead.pipeline_id,
      proposal_id: proposal?.id ?? null,
      expires_at: proposal?.expires_at ?? null,
      lost_since: lead.closed_at,
      last_interaction_at: lead.last_activity_at ?? lead.created_at,
      eligibility_reason: proposal
        ? "O sistema detectou esfriamento e gerou um alerta de retomada."
        : "Oportunidade perdida há pelo menos 30 dias.",
      eligible: excludedReason === null,
      excluded_reason: excludedReason,
      suggested_flow_id: suggestedFlow?.id ?? null,
      suggested_flow_name: suggestedFlow?.name ?? null,
      generated_alert: Boolean(proposal),
    };
  });

  return ok({ items }, { requestId });
}
