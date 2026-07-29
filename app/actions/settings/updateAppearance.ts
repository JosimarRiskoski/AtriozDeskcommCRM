"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import {
  organizationAppearanceSchema,
  type OrganizationAppearanceInput,
} from "@/lib/schemas/settings";
import { createClient } from "@/lib/supabase/server";

export type UpdateAppearanceResult = { ok: true } | { ok: false; error: string };

export async function updateOrganizationAppearance(
  input: OrganizationAppearanceInput,
): Promise<UpdateAppearanceResult> {
  const parsed = organizationAppearanceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "A aparência escolhida não é válida." };

  const user = await loadAuthUser();
  if (!user) return { ok: false, error: "Você precisa entrar novamente." };
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return { ok: false, error: "Organização não encontrada." };
  if (!user.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    return { ok: false, error: "Somente administradores podem alterar o padrão da empresa." };
  }

  const supabase = await createClient();
  const { data: organization, error: readError } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", activeOrg.orgId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };

  const currentSettings = (organization?.settings as Record<string, unknown> | null) ?? {};
  const currentAppearance =
    currentSettings.appearance && typeof currentSettings.appearance === "object"
      ? (currentSettings.appearance as Record<string, unknown>)
      : {};
  const nextSettings = {
    ...currentSettings,
    appearance: { ...currentAppearance, palette: parsed.data.palette },
  };

  const { error } = await supabase
    .from("organizations")
    .update({ settings: nextSettings })
    .eq("id", activeOrg.orgId);
  if (error) return { ok: false, error: error.message };

  const requestHeaders = await headers();
  await audit({
    action: "org.updated",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "organization_appearance",
    resourceId: activeOrg.orgId,
    requestId: requestHeaders.get("x-request-id"),
    ip: requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: requestHeaders.get("user-agent"),
    metadata: { palette: parsed.data.palette },
  });

  revalidatePath("/app");
  revalidatePath("/app/settings/appearance");
  return { ok: true };
}
