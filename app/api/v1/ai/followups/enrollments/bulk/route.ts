import { randomUUID } from "node:crypto";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  createSupabaseFollowupGateDb,
  resolveAgentForAutomaticTrigger,
} from "@/lib/followup/agent-followup-gate";
import { flowGraphSchema } from "@/lib/followup/graph-schema";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function firstEmbedded<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

const schema = z.object({
  pointer_id: z.string().uuid(),
  lead_ids: z.array(z.string().uuid()).min(1).max(500),
  confirm: z.boolean().default(false),
});

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", {
    requestId,
    resource: "followup_enrollments",
  });
  if (!authz.ok) return authz.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return fail("invalid_request", "Seleção ou fluxo inválido.", 422, { requestId });
  const supabase = await createClient();
  const [{ data: pointer }, { data: leads }] = await Promise.all([
    supabase
      .from("followup_flow_pointers")
      .select("id,name,status,active_version_id")
      .eq("organization_id", authz.org.orgId)
      .eq("id", parsed.data.pointer_id)
      .maybeSingle(),
    supabase
      .from("crm_leads")
      .select(
        "id,contact_id,status,contacts:contact_id(id,name,display_name,phone_number,is_blocked,is_anonymized)",
      )
      .eq("organization_id", authz.org.orgId)
      .in("id", parsed.data.lead_ids),
  ]);
  if (!pointer || pointer.status !== "active" || !pointer.active_version_id)
    return fail("flow_not_active", "Escolha um fluxo publicado.", 422, { requestId });

  const contactIds = [
    ...new Set((leads ?? []).map((lead) => lead.contact_id).filter(Boolean)),
  ] as string[];
  const { data: live } = contactIds.length
    ? await supabase
        .from("followup_enrollments")
        .select("contact_id")
        .eq("organization_id", authz.org.orgId)
        .in("contact_id", contactIds)
        .in("status", ["active", "waiting_reply", "paused_handoff"])
    : { data: [] as Array<{ contact_id: string }> };
  const liveContacts = new Set((live ?? []).map((item) => item.contact_id));
  const seen = new Set<string>();
  const eligible: Array<{ lead_id: string; contact_id: string; name: string }> = [];
  const excluded: Array<{ lead_id: string; reason: string }> = [];
  for (const raw of leads ?? []) {
    const lead = raw as unknown as {
      id: string;
      contact_id: string | null;
      contacts:
        | {
            id: string;
            name: string | null;
            display_name: string | null;
            phone_number: string | null;
            is_blocked: boolean;
            is_anonymized: boolean;
          }
        | Array<{
            id: string;
            name: string | null;
            display_name: string | null;
            phone_number: string | null;
            is_blocked: boolean;
            is_anonymized: boolean;
          }>
        | null;
    };
    const contact = firstEmbedded(lead.contacts);
    let reason: string | null = null;
    if (!lead.contact_id || !contact) reason = "Sem contato vinculado";
    else if (seen.has(lead.contact_id)) reason = "Contato repetido na seleção";
    else if (contact.is_blocked) reason = "Excluído — bloqueio total";
    else if (contact.is_anonymized) reason = "Contato anonimizado";
    else if (!contact.phone_number) reason = "Telefone inválido ou ausente";
    else if (liveContacts.has(lead.contact_id)) reason = "Já possui follow-up ativo";
    if (reason) excluded.push({ lead_id: lead.id, reason });
    else {
      seen.add(lead.contact_id!);
      eligible.push({
        lead_id: lead.id,
        contact_id: lead.contact_id!,
        name: contact!.name || contact!.display_name || contact!.phone_number || "Contato",
      });
    }
  }
  const preview = {
    selected: parsed.data.lead_ids.length,
    eligible: eligible.length,
    excluded: excluded.length,
    excluded_by_reason: Object.entries(
      excluded.reduce<Record<string, number>>((counts, item) => {
        counts[item.reason] = (counts[item.reason] ?? 0) + 1;
        return counts;
      }, {}),
    ).map(([reason, count]) => ({ reason, count })),
    contacts: eligible,
  };
  if (!parsed.data.confirm) return ok(preview, { requestId });
  if (eligible.length === 0)
    return fail("no_eligible_contacts", "Nenhum contato elegível.", 422, { requestId });

  const { data: version } = await supabase
    .from("followup_flow_versions")
    .select("graph")
    .eq("organization_id", authz.org.orgId)
    .eq("id", pointer.active_version_id)
    .maybeSingle();
  const graph = version ? flowGraphSchema.safeParse(version.graph) : null;
  const trigger = graph?.success ? graph.data.nodes.find((node) => node.type === "trigger") : null;
  if (!trigger)
    return fail("invalid_flow", "O fluxo publicado não possui início válido.", 422, { requestId });
  const agentId = await resolveAgentForAutomaticTrigger(
    createSupabaseFollowupGateDb(supabase),
    authz.org.orgId,
    pointer.id,
  );
  const now = new Date().toISOString();
  const { data: created, error } = await supabase
    .from("followup_enrollments")
    .insert(
      eligible.map((item) => ({
        organization_id: authz.org.orgId,
        pointer_id: pointer.id,
        version_id: pointer.active_version_id!,
        contact_id: item.contact_id,
        current_node_id: trigger.id,
        status: "active",
        next_eval_at: now,
        agent_id: agentId,
      })),
    )
    .select("id");
  if (error)
    return fail("conflict", "A seleção mudou. Valide novamente antes de confirmar.", 409, {
      requestId,
    });
  await audit({
    action: "followup_enrollment.bulk_created",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "followup_enrollment",
    requestId,
    metadata: { pointer_id: pointer.id, created: created?.length ?? 0, preview },
  });
  return ok({ ...preview, created: created?.length ?? 0 }, { requestId, status: 201 });
}
