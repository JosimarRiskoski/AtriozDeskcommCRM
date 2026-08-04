import { randomUUID } from "node:crypto";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Vocabulário de tags já usado pela organização para reutilização rápida. */
export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contacts")
    .select("tags")
    .eq("organization_id", authz.org.orgId)
    .eq("is_anonymized", false)
    .limit(1000);
  if (error) return Response.json({ error: { message: error.message } }, { status: 500 });
  const tags = Array.from(
    new Set(
      (data ?? [])
        .flatMap((row) => row.tags ?? [])
        .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));
  return ok(tags, { requestId });
}
