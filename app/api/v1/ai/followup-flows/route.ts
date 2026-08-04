/**
 * GET  /api/v1/ai/followup-flows — lista pointers da org ativa (any member).
 * POST /api/v1/ai/followup-flows — cria draft (manager+). Nasce status='draft',
 *   draft_graph null, trigger_config default 'manual' (default do banco).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createFollowupFlowSchema } from "@/lib/followup/api-schemas";
import { buildFollowupPresetGraph } from "@/lib/followup/presets";
import { flowGraphSchema } from "@/lib/followup/graph-schema";

export const dynamic = "force-dynamic";

const LIST_COLUMNS =
  "id, name, status, active_version_id, handoff_policy, trigger_config, updated_at";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "followup_flows" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("followup_flow_pointers")
    .select(LIST_COLUMNS)
    .eq("organization_id", activeOrg.orgId)
    .order("updated_at", { ascending: false });
  if (error) return fail("internal_error", error.message, 500, { requestId });
  const pointers = data ?? [];
  const versionIds = pointers
    .map((pointer) => pointer.active_version_id)
    .filter((id): id is string => Boolean(id));
  const [{ data: versions }, { data: agentVersions }] = await Promise.all([
    versionIds.length
      ? supabase
          .from("followup_flow_versions")
          .select("id,graph")
          .eq("organization_id", activeOrg.orgId)
          .in("id", versionIds)
      : Promise.resolve({ data: [] }),
    supabase
      .from("ai_agent_versions")
      .select(
        "followup,channel_sessions:channel_session_id(display_name,phone_number,waha_session_name),ai_agents:agent_id(name)",
      )
      .eq("organization_id", activeOrg.orgId)
      .eq("status", "published"),
  ]);
  const graphById = new Map((versions ?? []).map((version) => [version.id, version.graph]));
  const embedded = <T>(value: T | T[] | null): T | null =>
    Array.isArray(value) ? (value[0] ?? null) : value;
  const result = pointers.map((pointer) => {
    const parsed = pointer.active_version_id
      ? flowGraphSchema.safeParse(graphById.get(pointer.active_version_id))
      : null;
    const nodes = parsed?.success ? parsed.data.nodes : [];
    const waits = nodes.filter((node) => node.type === "wait");
    const durationMinutes = waits.reduce(
      (total, node) =>
        total +
        Math.round(
          (node.config.mode === "fixed" ? node.config.duration_ms : node.config.max_ms) / 60000,
        ),
      0,
    );
    const firstWait = waits[0];
    const binding = (agentVersions ?? []).find((version) => {
      const followup = version.followup as {
        enabled?: boolean;
        flow_pointer_ids?: string[];
      } | null;
      return followup?.enabled && followup.flow_pointer_ids?.includes(pointer.id);
    }) as unknown as
      | {
          ai_agents: { name: string } | Array<{ name: string }> | null;
          channel_sessions:
            | {
                display_name: string | null;
                phone_number: string | null;
                waha_session_name: string;
              }
            | Array<{
                display_name: string | null;
                phone_number: string | null;
                waha_session_name: string;
              }>
            | null;
        }
      | undefined;
    const agent = binding ? embedded(binding.ai_agents) : null;
    const channel = binding ? embedded(binding.channel_sessions) : null;
    const trigger = (pointer.trigger_config ?? {}) as { cancel_on_reply?: boolean };
    return {
      ...pointer,
      objective: pointer.name,
      duration_minutes: durationMinutes,
      steps_count: nodes.filter((node) => node.type === "action").length,
      next_send_minutes: firstWait
        ? Math.round(
            (firstWait.config.mode === "fixed"
              ? firstWait.config.duration_ms
              : firstWait.config.max_ms) / 60000,
          )
        : 0,
      agent_name: agent?.name ?? null,
      channel_name: channel
        ? channel.display_name || channel.phone_number || channel.waha_session_name
        : null,
      cancel_on_reply: trigger.cancel_on_reply !== false,
    };
  });
  return ok(result, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "followup_flows" });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }

  const parsed = createFollowupFlowSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const supabase = await createClient();
  const draftGraph = buildFollowupPresetGraph(parsed.data.preset_id);
  const { data: created, error: insErr } = await supabase
    .from("followup_flow_pointers")
    .insert({
      organization_id: activeOrg.orgId,
      name: parsed.data.name,
      draft_graph: draftGraph,
      trigger_config: { kind: "manual", cancel_on_reply: true },
      handoff_policy: "pause",
    })
    .select("*")
    .single();

  if (insErr || !created) {
    if (insErr?.code === "23505") {
      return fail("conflict", "Já existe um fluxo com este nome.", 409, { requestId });
    }
    return fail("internal_error", insErr?.message ?? "followup_flow_insert_failed", 500, {
      requestId,
    });
  }

  void audit({
    action: "followup_flow.created",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "followup_flow_pointer",
    resourceId: created.id,
    requestId,
    metadata: { name: parsed.data.name, preset_id: parsed.data.preset_id },
  });

  return ok(created, { requestId, status: 201 });
}
