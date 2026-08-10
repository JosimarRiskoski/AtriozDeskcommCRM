import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const GUIDANCE: Record<string, string> = {
  credencial_recusada: "A chave foi recusada. Revalide a credencial usada pelo agente.",
  modelo_inexistente: "O modelo não existe ou não está disponível. Escolha outro modelo.",
  limite_ou_saldo: "O provedor recusou por limite ou saldo. Verifique o faturamento da API.",
  provedor_indisponivel: "O provedor ou a rede falhou. Tente novamente e acompanhe a recorrência.",
  modelo_sem_ferramentas: "O modelo não conseguiu usar as ferramentas configuradas.",
  erro_desconhecido: "Abra o detalhe técnico e repita o teste após corrigir a configuração.",
};

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "ai_runs" });
  if (!authz.ok) return authz.response;

  const params = new URL(req.url).searchParams;
  const status = params.get("status");
  if (status && status !== "ok" && status !== "erro") {
    return fail("invalid_request", "Status inválido.", 422, { requestId });
  }

  const admin = createAdminClient();
  let query = admin
    .from("llm_calls")
    .select(
      "id, agent_id, contact_id, job_id, purpose, provider, model, status, error_code, error_message, http_status, origem_da_escolha, input_tokens, output_tokens, cost_cents, latency_ms, created_at",
    )
    .eq("organization_id", authz.org.orgId)
    .order("created_at", { ascending: false })
    .limit(150);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) return fail("internal_error", "Não foi possível consultar as execuções.", 500, { requestId });

  const executions = (data ?? []).map((row) => ({
    ...row,
    guidance: row.status === "erro" ? GUIDANCE[row.error_code ?? "erro_desconhecido"] : null,
  }));
  return ok(
    {
      executions,
      summary: {
        total: executions.length,
        errors: executions.filter((row) => row.status === "erro").length,
      },
    },
    { requestId },
  );
}
