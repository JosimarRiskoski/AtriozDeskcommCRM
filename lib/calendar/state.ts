import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TTL_MS = 10 * 60 * 1000;

function signingKey(): string {
  const secret = process.env.INTERNAL_SECRET ?? "";
  if (secret.length < 16) throw new Error("INTERNAL_SECRET precisa ter ao menos 16 caracteres");
  return secret;
}

export function issueCalendarState(organizationId: string): string {
  const payload = JSON.stringify({
    organizationId,
    nonce: randomBytes(16).toString("hex"),
    expiresAt: Date.now() + TTL_MS,
  });
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  const signature = createHmac("sha256", signingKey()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyCalendarState(value: string | null): { organizationId: string } | null {
  if (!value) return null;
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;
  const expected = createHmac("sha256", signingKey()).update(encoded).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
      organizationId?: string;
      expiresAt?: number;
    };
    if (!payload.organizationId || !payload.expiresAt || payload.expiresAt < Date.now()) return null;
    return { organizationId: payload.organizationId };
  } catch {
    return null;
  }
}
