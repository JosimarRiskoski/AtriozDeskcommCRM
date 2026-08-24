import Link from "next/link";

import { Card } from "@/components/ui/card";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

export const dynamic = "force-dynamic";

interface SettingsLink {
  href: string;
  title: string;
  description: string;
  group: "Conta" | "Operação comercial" | "Integrações" | "Segurança avançada";
  adminOnly?: boolean;
  managerOnly?: boolean;
}

const LINKS: SettingsLink[] = [
  {
    href: "/app/settings/appearance",
    title: "Aparência",
    description: "Tema claro, escuro ou automático e identidade visual do CRM.",
    group: "Conta",
  },
  {
    href: "/app/settings/profile",
    title: "Perfil",
    description: "Nome, idioma, fuso e avatar.",
    group: "Conta",
  },
  {
    href: "/app/settings/security",
    title: "Segurança",
    description: "MFA, códigos de recuperação, sessões.",
    group: "Conta",
  },
  {
    href: "/app/settings/notifications",
    title: "Notificações",
    description: "Escolha quais alertas deseja receber no CRM e por e-mail.",
    group: "Conta",
  },
  {
    href: "/app/system-health",
    title: "Saúde do sistema",
    description: "WhatsApp, banco, automações, IA, e-mail e webhooks em uma única tela.",
    group: "Integrações",
    managerOnly: true,
  },
  {
    href: "/app/settings/api-tokens",
    title: "API Tokens",
    description: "Acesso técnico entre sistemas. Use apenas com orientação especializada.",
    group: "Segurança avançada",
    adminOnly: true,
  },
  {
    href: "/app/settings/tenant",
    title: "Organização",
    description: "Dados da empresa, retenção, DPO.",
    group: "Conta",
    adminOnly: true,
  },
  {
    href: "/app/settings/human-support",
    title: "Atendimento humano",
    description: "Responsáveis, prazos, handoff e avisos aos gestores.",
    group: "Operação comercial",
    adminOnly: true,
  },
  {
    href: "/app/settings/tenant/pipelines",
    title: "Pipelines",
    description: "Funis, etapas, campos e motivos de perda.",
    group: "Operação comercial",
    adminOnly: true,
  },
  {
    href: "/app/connections",
    title: "Conexões WhatsApp",
    description: "Saúde, reconexão e novos números.",
    group: "Integrações",
    adminOnly: true,
  },
  {
    href: "/app/settings/google-calendar",
    title: "Google Agenda",
    description: "Visitas, consultas, Google Meet e lembretes pelo WhatsApp.",
    group: "Integrações",
    managerOnly: true,
  },
  {
    href: "/app/settings/meta-capi",
    title: "Conversões da Meta",
    description: "Enviar negócios ganhos ao Dataset/Pixel com segurança.",
    group: "Integrações",
    adminOnly: true,
  },
  {
    href: "/app/audit",
    title: "Histórico de segurança",
    description: "Quem alterou o quê e quando.",
    group: "Segurança avançada",
    managerOnly: true,
  },
];

export default async function SettingsHubPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  const role = activeOrg?.role;
  const isAdmin = user.is_platform_admin || (role && ROLE_RANK[role] >= ROLE_RANK.admin);
  const isManager = user.is_platform_admin || (role && ROLE_RANK[role] >= ROLE_RANK.manager);

  const visible = LINKS.filter((l) => {
    if (l.adminOnly && !isAdmin) return false;
    if (l.managerOnly && !isManager) return false;
    return true;
  });
  const groups = (["Conta", "Operação comercial", "Integrações", "Segurança avançada"] as const)
    .map((title) => ({ title, items: visible.filter((item) => item.group === title) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie sua conta, organização e integrações.
        </p>
      </header>
      <div className="space-y-7">
        {groups.map((group) => (
          <section key={group.title} aria-labelledby={`settings-${group.title}`}>
            <h2 id={`settings-${group.title}`} className="mb-3 text-sm font-semibold">
              {group.title}
            </h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {group.items.map((item) => (
                <Link key={item.href} href={item.href} className="block">
                  <Card className="h-full p-4 transition-colors hover:border-border-strong">
                    <h3 className="text-sm font-semibold">{item.title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
