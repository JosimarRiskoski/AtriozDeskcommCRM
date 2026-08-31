import type { SupabaseClient } from "@supabase/supabase-js";
import { emitLeadActivity, stageChangeReason } from "@/lib/leads/activity-emitter";
import { registraFalhaDeAtividade } from "@/lib/leads/activity-write-failure";
import { logger } from "@/lib/logger";

export type AppointmentStageTransition = "pending" | "confirmed";

export const APPOINTMENT_STAGE_SLUG: Record<AppointmentStageTransition, string> = {
  pending: "agendamento-solicitado",
  confirmed: "agendado",
};

export async function moveLeadForAppointment(
  admin: SupabaseClient,
  input: { organizationId: string; leadId: string; transition: AppointmentStageTransition },
): Promise<{ moved: boolean; reason: string }> {
  const { data: lead, error: leadError } = await admin
    .from("crm_leads")
    .select("id,pipeline_id,stage_id,contact_id,status")
    .eq("id", input.leadId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (leadError || !lead) return { moved: false, reason: leadError ? "read_failed" : "lead_not_found" };
  if (lead.status !== "open") return { moved: false, reason: "lead_closed" };

  const { data: target, error: targetError } = await admin
    .from("crm_stages")
    .select("id,name")
    .eq("pipeline_id", lead.pipeline_id)
    .eq("slug", APPOINTMENT_STAGE_SLUG[input.transition])
    .eq("is_archived", false)
    .maybeSingle();
  if (targetError || !target) return { moved: false, reason: targetError ? "stage_read_failed" : "stage_not_configured" };
  if (target.id === lead.stage_id) return { moved: false, reason: "already_there" };

  const { data: source } = await admin.from("crm_stages").select("name").eq("id", lead.stage_id).maybeSingle();
  const { data: updated, error: updateError } = await admin
    .from("crm_leads")
    .update({ stage_id: target.id })
    .eq("id", lead.id)
    .eq("stage_id", lead.stage_id)
    .select("id");
  if (updateError || (updated ?? []).length === 0) {
    return { moved: false, reason: updateError ? "write_failed" : "human_conflict" };
  }

  const activity = await emitLeadActivity(admin, {
    organizationId: input.organizationId,
    leadId: lead.id,
    contactId: lead.contact_id,
    type: "stage_changed",
    sourceModule: "calendar",
    sourceId: lead.id,
    actor: { type: "webhook_source", id: "appointment-stage-move" },
    reason: stageChangeReason(source?.name ?? null, target.name),
    payload: { from_stage_id: lead.stage_id, to_stage_id: target.id, appointment_transition: input.transition },
  });
  if (!activity.ok) {
    await registraFalhaDeAtividade(admin, {
      organizationId: input.organizationId,
      leadId: lead.id,
      tipo: "stage_changed",
      origem: "lib/leads/appointment-stage-move",
      erro: activity.error,
    });
  }

  const { error: eventError } = await admin.rpc("emit_event", {
    p_event_type: "lead.stage_changed",
    p_entity_kind: "crm_lead",
    p_entity_id: lead.id,
    p_payload: { pipeline_id: lead.pipeline_id, from_stage_id: lead.stage_id, to_stage_id: target.id, status: lead.status },
    p_metadata: { actor_kind: "system", source: "appointment-stage-move", transition: input.transition },
    p_organization_id: input.organizationId,
  });
  if (eventError) logger.error("[calendar] lead stage event failed", { lead_id: lead.id, error: eventError.message });
  return { moved: true, reason: "moved" };
}
