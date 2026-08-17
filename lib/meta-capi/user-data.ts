import { createHash } from "node:crypto";
const sha256 = (value: string) =>
  createHash("sha256").update(value.trim().toLowerCase()).digest("hex");

type MetaBrowserIdentifiers = {
  fbc?: string | null;
  fbp?: string | null;
};

export function normalizedMetaUserData(
  phone?: string | null,
  email?: string | null,
  externalId?: string | null,
  browserIdentifiers: MetaBrowserIdentifiers = {},
) {
  const fbc = browserIdentifiers.fbc?.trim();
  const fbp = browserIdentifiers.fbp?.trim();
  return {
    ...(phone ? { ph: [sha256(phone.replace(/\D/g, ""))] } : {}),
    ...(email ? { em: [sha256(email)] } : {}),
    ...(externalId ? { external_id: [sha256(externalId)] } : {}),
    ...(fbc ? { fbc } : {}),
    ...(fbp ? { fbp } : {}),
  };
}
