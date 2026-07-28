import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth/require-role";
import { fail, ok } from "@/lib/api/wrappers";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const ALLOWED = new Set(["audio/ogg", "audio/opus", "audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/webm"]);

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "outreach_campaigns" });
  if (!authz.ok) return authz.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return fail("validation_failed", "Campanha inválida.", 422, { requestId });
  const file = (await req.formData()).get("file");
  if (!(file instanceof File) || !ALLOWED.has(file.type) || file.size <= 0 || file.size > MAX_AUDIO_BYTES) return fail("validation_failed", "Envie áudio válido de até 16 MB.", 422, { requestId });
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: campaign } = await admin.from("outreach_campaigns").select("id,status").eq("id", id).eq("organization_id", authz.org.orgId).maybeSingle();
  if (!campaign) return fail("not_found", "Campanha não encontrada.", 404, { requestId });
  if (campaign.status !== "draft") return fail("conflict", "O áudio só pode ser alterado enquanto a campanha está em rascunho.", 409, { requestId });
  const ext = file.name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "ogg";
  const path = `${authz.org.orgId}/campaigns/${id}/audio-${randomUUID()}.${ext}`;
  const { error: uploadError } = await admin.storage.from("whatsapp-media").upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return fail("internal_error", "Não foi possível armazenar o áudio.", 500, { requestId });
  const { error } = await admin.from("outreach_campaigns").update({ audio_storage_path: path, updated_at: new Date().toISOString() }).eq("id", id).eq("organization_id", authz.org.orgId);
  if (error) { await admin.storage.from("whatsapp-media").remove([path]); return fail("internal_error", "Não foi possível vincular o áudio.", 500, { requestId }); }
  return ok({ audio_storage_path: path, size: file.size, mime: file.type }, { requestId });
}
