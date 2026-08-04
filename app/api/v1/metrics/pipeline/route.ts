import { randomUUID } from "node:crypto";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  pipeline_id: z.string().uuid().optional(),
});

export async function GET(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "metrics" });
  if (!authz.ok) return authz.response;
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    pipeline_id: url.searchParams.get("pipeline_id") || undefined,
  });
  if (!parsed.success)
    return fail("invalid_request", "Período ou funil inválido.", 422, { requestId });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "fn_pipeline_management_metrics" as never,
    {
      p_org: authz.org.orgId,
      p_from: parsed.data.from,
      p_to: parsed.data.to,
      p_pipeline: parsed.data.pipeline_id ?? null,
    } as never,
  );
  if (error)
    return fail("internal_error", "Não foi possível calcular os indicadores do Kanban.", 500, {
      requestId,
    });
  return ok(data, { requestId });
}
