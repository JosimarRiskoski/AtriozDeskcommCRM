import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function firstEmbedded<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "followup_enrollments" });
  if (!authz.ok) return authz.response;
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("followup_enrollments")
    .select(
      "id,status,current_node_id,next_eval_at,started_at,agent_id,followup_flow_pointers:pointer_id(name,handoff_policy,trigger_config),ai_agents:agent_id(name)",
    )
    .eq("organization_id", authz.org.orgId)
    .eq("contact_id", id)
    .in("status", ["active", "waiting_reply", "paused_handoff"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error)
    return fail("internal_error", "Não foi possível consultar o follow-up do contato.", 500, {
      requestId,
    });
  if (!data) return ok(null, { requestId });
  const row = data as typeof data & {
    followup_flow_pointers:
      | { name: string; handoff_policy: string; trigger_config: Record<string, unknown> }
      | Array<{ name: string; handoff_policy: string; trigger_config: Record<string, unknown> }>
      | null;
    ai_agents: { name: string } | Array<{ name: string }> | null;
  };
  return ok(
    {
      ...row,
      followup_flow_pointers: firstEmbedded(row.followup_flow_pointers),
      ai_agents: firstEmbedded(row.ai_agents),
    },
    { requestId },
  );
}
