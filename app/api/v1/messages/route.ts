/**
 * POST /api/v1/messages — envia mensagem outbound (handler em ./_handler.ts).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { sendMessageSchema, validateRequest, type SendMessageInput } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

import { sendMessageHandler } from "./_handler";
import {
  claimMessageSend,
  completeMessageSend,
  releaseMessageSend,
} from "./_idempotency";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supabase = await createClient();

  // spec 13 §4: escrita é agent+ (viewer é read-only).
  const authz = await requireRole("agent", { requestId, resource: "messages" });
  if (!authz.ok) return authz.response;
  const user = authz.user;
  const activeOrg = authz.org;

  let input;
  try {
    input = await validateRequest(sendMessageSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  const idempotencyKey = req.headers.get("Idempotency-Key");
  let claimedHash: string | null = null;
  try {
    if (idempotencyKey) {
      const claim = await claimMessageSend(
        supabase,
        activeOrg.orgId,
        idempotencyKey,
        input as SendMessageInput,
      );
      if (claim.state === "cached") return ok(claim.message, { status: 200, requestId });
      if (claim.state === "processing") {
        return fail(
          "idempotency_in_progress",
          "Esta mensagem já está sendo enviada.",
          409,
          { requestId },
        );
      }
      if (claim.state === "conflict") {
        return fail(
          "idempotency_conflict",
          "A chave de envio já foi usada com outra mensagem.",
          409,
          { requestId },
        );
      }
      claimedHash = claim.requestHash;
    }

    const message = await sendMessageHandler(
      supabase,
      {
        organization_id: activeOrg.orgId,
        actor: { type: "user", id: user.id },
        requestId,
      },
      input as SendMessageInput,
    );
    if (idempotencyKey && claimedHash) {
      await completeMessageSend(
        supabase,
        activeOrg.orgId,
        idempotencyKey,
        claimedHash,
        message,
      );
    }
    return ok(message, { status: 201, requestId });
  } catch (err) {
    if (idempotencyKey && claimedHash) {
      await releaseMessageSend(supabase, activeOrg.orgId, idempotencyKey);
    }
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { requestId });
    }
    throw err;
  }
}
