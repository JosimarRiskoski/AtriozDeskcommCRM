import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { loadAuthUser } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Faça login novamente.", 401, { requestId });

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES + 256_000) {
    return fail("payload_too_large", "A foto deve ter no máximo 2 MB.", 413, { requestId });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return fail("validation_failed", "Selecione uma foto.", 422, { requestId });
  }
  const extension = EXTENSIONS[file.type];
  if (!extension) {
    return fail("unsupported_media_type", "Use uma imagem JPG, PNG ou WebP.", 415, { requestId });
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return fail("payload_too_large", "A foto deve ter no máximo 2 MB.", 413, { requestId });
  }

  const admin = createAdminClient();
  const path = `${user.id}/avatar-${randomUUID()}.${extension}`;
  const { error } = await admin.storage.from("profile-avatars").upload(
    path,
    Buffer.from(await file.arrayBuffer()),
    { contentType: file.type, upsert: false, cacheControl: "3600" },
  );
  if (error) {
    console.error("[profile.avatar] upload failed", error.message);
    return fail("internal_error", "Não foi possível salvar a foto.", 500, { requestId });
  }

  const { data } = admin.storage.from("profile-avatars").getPublicUrl(path);
  return ok({ avatar_url: data.publicUrl }, { requestId });
}
