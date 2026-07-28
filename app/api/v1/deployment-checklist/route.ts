import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const MANUAL_IDS = ["backup_restored", "end_to_end_tested"] as const;

const updateSchema = z.object({
  id: z.enum(MANUAL_IDS),
  completed: z.boolean(),
});

export interface DeploymentChecklistItem {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  automatic: boolean;
  action_label?: string;
  action_url?: string;
}

export interface DeploymentChecklistPayload {
  completed: number;
  total: number;
  ready: boolean;
  items: DeploymentChecklistItem[];
}

interface ChecklistSettings {
  backup_restored?: boolean;
  end_to_end_tested?: boolean;
}

function manualSettings(settings: unknown): ChecklistSettings {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return {};
  const value = (settings as Record<string, unknown>).deployment_checklist;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as ChecklistSettings;
}

async function loadChecklist(orgId: string): Promise<DeploymentChecklistPayload | null> {
  const admin = createAdminClient();
  const [organization, sessions, admins, agents, pipelines] = await Promise.all([
    admin.from("organizations").select("id, settings").eq("id", orgId).maybeSingle(),
    admin.from("channel_sessions").select("id, status").eq("organization_id", orgId),
    admin
      .from("user_organizations")
      .select("user_id, role")
      .eq("organization_id", orgId)
      .is("revoked_at", null)
      .not("accepted_at", "is", null)
      .eq("role", "admin"),
    admin
      .from("ai_agents")
      .select("id, published_version_id, is_active")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .is("archived_at", null),
    admin
      .from("crm_pipelines")
      .select("id")
      .eq("organization_id", orgId)
      .eq("is_archived", false),
  ]);
  if (organization.error || !organization.data) return null;

  const manual = manualSettings(organization.data.settings);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const validDomain = /^https:\/\//.test(appUrl) && !/localhost|127\.0\.0\.1/.test(appUrl);
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  const items: DeploymentChecklistItem[] = [
    {
      id: "domain",
      title: "Domínio e HTTPS",
      description: validDomain ? appUrl : "Configure o domínio público HTTPS no EasyPanel.",
      completed: validDomain,
      automatic: true,
    },
    {
      id: "supabase",
      title: "Supabase",
      description: "URL, chave pública e acesso do servidor configurados.",
      completed: supabaseConfigured,
      automatic: true,
    },
    {
      id: "organization",
      title: "Organização",
      description: "Organização criada e isolada no banco.",
      completed: true,
      automatic: true,
      action_label: "Revisar organização",
      action_url: "/app/settings/tenant",
    },
    {
      id: "admin",
      title: "Administrador do cliente",
      description: "Existe ao menos um administrador ativo e com convite aceito.",
      completed: (admins.data?.length ?? 0) > 0,
      automatic: true,
      action_label: "Abrir equipe",
      action_url: "/app/team",
    },
    {
      id: "whatsapp",
      title: "WhatsApp",
      description: "Existe ao menos um número com estado operacional.",
      completed: (sessions.data ?? []).some((session) => session.status === "WORKING"),
      automatic: true,
      action_label: "Abrir conexões",
      action_url: "/app/connections",
    },
    {
      id: "email",
      title: "E-mail",
      description: "Resend e remetente estão configurados no servidor.",
      completed: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
      automatic: true,
      action_label: "Abrir equipe",
      action_url: "/app/team",
    },
    {
      id: "pipeline",
      title: "Funil comercial",
      description: "Existe ao menos um funil ativo para receber negócios.",
      completed: (pipelines.data?.length ?? 0) > 0,
      automatic: true,
      action_label: "Configurar funis",
      action_url: "/app/settings/tenant/pipelines",
    },
    {
      id: "agent",
      title: "Agente de IA publicado",
      description: "Existe um agente ativo com versão publicada.",
      completed: (agents.data ?? []).some((agent) => Boolean(agent.published_version_id)),
      automatic: true,
      action_label: "Abrir agentes",
      action_url: "/app/ai/agents",
    },
    {
      id: "backup_restored",
      title: "Backup e restauração ensaiados",
      description: "Confirme somente depois de criar o backup e provar uma restauração segura.",
      completed: manual.backup_restored === true,
      automatic: false,
    },
    {
      id: "end_to_end_tested",
      title: "Teste ponta a ponta",
      description: "Mensagem recebida, resposta entregue, CRM atualizado e IA controlada por contato.",
      completed: manual.end_to_end_tested === true,
      automatic: false,
    },
  ];
  const completed = items.filter((item) => item.completed).length;
  return { completed, total: items.length, ready: completed === items.length, items };
}

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "deployment_checklist" });
  if (!authz.ok) return authz.response;
  const checklist = await loadChecklist(authz.org.orgId);
  if (!checklist) return fail("internal_error", "Não foi possível montar o checklist.", 500, { requestId });
  return ok(checklist, { requestId });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "deployment_checklist" });
  if (!authz.ok) return authz.response;
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Item manual inválido.", 422, { requestId });
  }

  const admin = createAdminClient();
  const { data: organization, error } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", authz.org.orgId)
    .maybeSingle();
  if (error || !organization) {
    return fail("internal_error", "Não foi possível carregar a organização.", 500, { requestId });
  }
  const settings =
    organization.settings && typeof organization.settings === "object" && !Array.isArray(organization.settings)
      ? { ...organization.settings }
      : {};
  const current = manualSettings(settings);
  const deploymentChecklist = { ...current, [parsed.data.id]: parsed.data.completed };
  const { error: updateError } = await admin
    .from("organizations")
    .update({ settings: { ...settings, deployment_checklist: deploymentChecklist } })
    .eq("id", authz.org.orgId);
  if (updateError) return fail("internal_error", "Não foi possível salvar o checklist.", 500, { requestId });

  void audit({
    action: "org.updated",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "organization",
    resourceId: authz.org.orgId,
    requestId,
    metadata: { deployment_checklist_item: parsed.data.id, completed: parsed.data.completed },
  });
  const checklist = await loadChecklist(authz.org.orgId);
  if (!checklist) return fail("internal_error", "Checklist salvo, mas não pôde ser recarregado.", 500, { requestId });
  return ok(checklist, { requestId });
}
