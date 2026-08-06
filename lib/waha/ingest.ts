/**
 * lib/waha/ingest.ts — pipeline de ingestão WAHA compartilhado pelos dois route
 * handlers de webhook (`/waha` global e `/waha/[token]` per-tenant).
 *
 * Fonte única da verdade para: parse de identidade WhatsApp, resolução de
 * contato/conversa e persistência de mensagem. Resolução é ATÔMICA via RPC
 * (fn_upsert_wa_contact / fn_upsert_wa_conversation) — o padrão check-then-act
 * antigo criava um contato/conversa novo a cada mensagem porque o WAHA NOWEB
 * emite `message` E `message.any` para a mesma mensagem (corrida). Ver migration
 * 0027 para o modelo de identidade canônica.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { audit } from "@/lib/audit";
import { findActiveContactByPhone } from "@/lib/contacts/find-by-phone";
import type { createAdminClient } from "@/lib/supabase/admin";
import { ackToStatus } from "@/lib/types/messaging";
import { getWahaClient } from "@/lib/waha/client";
import { parseChatId, type ChatIdentity } from "@/lib/waha/identity";
export { parseChatId } from "@/lib/waha/identity";
import { bareWaMessageId, chatIdFromWaMessageId } from "@/lib/waha/message-id";
import { isExplicitStopRequest } from "@/lib/waha/stop-detection";
import { handleManagerGroupCommand } from "@/lib/human-support/group-commands";

type Admin = ReturnType<typeof createAdminClient>;

interface Session {
  id: string;
  organization_id: string;
  waha_session_name?: string | null;
  provider?: "waha" | "evolution";
  external_session_name?: string | null;
}

interface PendingInboundRow {
  id: string;
  organization_id: string;
  channel_session_id: string;
  external_id: string;
  payload: WahaPayload;
  lid: string;
  attempts: number | null;
}

export interface WahaPayload {
  /** Provedor de origem. Mantém o pipeline comercial único durante a migração. */
  provider?: "waha" | "evolution";
  id?: string;
  from?: string;
  to?: string;
  fromMe?: boolean;
  body?: string;
  type?: string;
  hasMedia?: boolean;
  ack?: number;
  ackName?: string;
  participant?: string;
  author?: string;
  status?: string;
  timestamp?: number;
  mediaUrl?: string;
  mimetype?: string;
  /** WAHA >= 2026.x (NOWEB): mídia vem aninhada em payload.media. */
  media?: { url?: string | null; mimetype?: string | null; filename?: string | null } | null;
  _data?: {
    notifyName?: string;
    pushName?: string;
    /** NOWEB: o conteúdo real (imageMessage, stickerMessage, …) — fonte do tipo. */
    message?: Record<string, unknown>;
  } & Record<string, unknown>;
  vote?: {
    id?: string;
    to?: string;
    from?: string;
    fromMe?: boolean;
    selectedOptions?: string[];
    timestamp?: number;
  };
  poll?: { id?: string };
}

export interface WahaEnvelope {
  event?: string;
  session?: string;
  payload?: WahaPayload;
}

/**
 * Resolve o chat do cliente em mensagens enviadas pelo proprio celular.
 * NOWEB costuma preencher `to`; GOWS envia `to: null` e coloca o destinatario
 * em `from` (e tambem em `_data.Info.Chat`).
 */
export function outboundChatIdOf(p: WahaPayload): string {
  if (p.to) return p.to;
  // NOWEB pode omitir `to` quando a mensagem foi escrita no celular. O id
  // serializado tem a forma `{fromMe}_{chatId}_{bareId}`, então é a fonte mais
  // confiável antes de recorrer a `from` (que varia de significado por engine).
  const chatFromMessageId = chatIdFromWaMessageId(p.id ?? "");
  if (chatFromMessageId) return chatFromMessageId;
  if (p.fromMe && p.from) return p.from;

  const info = p._data?.Info;
  if (info && typeof info === "object" && "Chat" in info) {
    const chat = (info as { Chat?: unknown }).Chat;
    if (typeof chat === "string") return chat;
  }

  return "";
}

async function preservePendingIdentity(
  admin: Admin,
  session: Session,
  payload: WahaPayload,
  chatId: string,
  lid: string,
  requestId: string,
): Promise<void> {
  if (!payload.id) return;
  const { error } = await admin.from("whatsapp_inbound_pending").upsert(
    {
      organization_id: session.organization_id,
      channel_session_id: session.id,
      external_id: payload.id,
      chat_id: chatId,
      lid,
      payload,
      status: "pending",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,channel_session_id,external_id", ignoreDuplicates: true },
  );
  if (error) {
    console.error("[waha.ingest] nao foi possivel preservar mensagem @lid", error.message);
    return;
  }
  await audit({
    action: "message.identity_pending",
    organizationId: session.organization_id,
    resourceType: "message",
    requestId,
    metadata: { external_id: payload.id, channel_session_id: session.id, lid },
  });
}

async function reconcilePendingIdentity(
  admin: Admin,
  session: Session,
  lid: string,
  requestId: string,
  resolvedPhone?: string,
): Promise<void> {
  const { data: pending, error } = await admin
    .from("whatsapp_inbound_pending")
    .select("id,external_id,payload,attempts")
    .eq("organization_id", session.organization_id)
    .eq("channel_session_id", session.id)
    .eq("lid", lid)
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: true })
    .limit(50);
  if (error || !pending?.length) return;

  for (const item of pending) {
    await admin
      .from("whatsapp_inbound_pending")
      .update({
        status: "reconciling",
        attempts: Number(item.attempts ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id)
      .in("status", ["pending", "failed"]);

    try {
      const pendingPayload = item.payload as unknown as WahaPayload;
      const replayPayload =
        session.provider === "evolution" && resolvedPhone
          ? {
              ...pendingPayload,
              provider: "evolution" as const,
              from: `${resolvedPhone.replace(/\D/g, "")}@s.whatsapp.net`,
              _data: {
                ...pendingPayload._data,
                original_remote_jid: `${lid}@lid`,
                remote_jid_alt: `${resolvedPhone.replace(/\D/g, "")}@s.whatsapp.net`,
              },
            }
          : pendingPayload;
      await handleInbound(admin, session, replayPayload, requestId, true);
      const { data: reconciledMessage } = await admin
        .from("messages")
        .select("contact_id,conversation_id")
        .eq("organization_id", session.organization_id)
        .eq("external_id", item.external_id)
        .maybeSingle();
      if (!reconciledMessage) throw new Error("mensagem ainda nao reconciliada");

      await admin
        .from("whatsapp_inbound_pending")
        .update({
          status: "reconciled",
          reconciled_contact_id: reconciledMessage.contact_id,
          reconciled_conversation_id: reconciledMessage.conversation_id,
          reconciled_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);
      await audit({
        action: "message.identity_reconciled",
        organizationId: session.organization_id,
        resourceType: "message",
        resourceId: item.external_id,
        requestId,
        metadata: { pending_id: item.id, lid },
      });
    } catch (reconcileError) {
      await admin
        .from("whatsapp_inbound_pending")
        .update({
          status: "failed",
          last_error:
            reconcileError instanceof Error
              ? reconcileError.message.slice(0, 500)
              : "erro desconhecido",
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);
    }
  }
}

/**
 * Reprocessa mensagens que chegaram com identidade @lid antes de o WhatsApp
 * disponibilizar o telefone correspondente. A entrada normal continua sendo
 * instantânea via webhook; este é apenas o cinto de segurança para não deixar
 * uma mensagem real invisível até a próxima fala do mesmo contato.
 */
export async function reconcilePendingWahaInbound(
  admin: Admin,
  limit = 50,
): Promise<{ scanned: number; reconciled: number; still_pending: number; failed: number }> {
  const { data, error } = await admin
    .from("whatsapp_inbound_pending")
    .select("id,organization_id,channel_session_id,external_id,payload,lid,attempts")
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`pending_inbound_query_failed: ${error.message}`);

  const rows = (data ?? []) as unknown as PendingInboundRow[];
  let reconciled = 0;
  let stillPending = 0;
  let failed = 0;

  for (const row of rows) {
    const { data: claimed } = await admin
      .from("whatsapp_inbound_pending")
      .update({
        status: "reconciling",
        attempts: Number(row.attempts ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .in("status", ["pending", "failed"])
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const { data: session } = await admin
      .from("channel_sessions")
      .select("id,organization_id,waha_session_name")
      .eq("id", row.channel_session_id)
      .eq("organization_id", row.organization_id)
      .maybeSingle();
    if (!session) {
      failed++;
      await admin
        .from("whatsapp_inbound_pending")
        .update({
          status: "failed",
          last_error: "conexão WhatsApp não encontrada",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      continue;
    }

    try {
      await handleInbound(admin, session, row.payload, `pending-${row.id}`, true);
      const { data: message } = await admin
        .from("messages")
        .select("contact_id,conversation_id")
        .eq("organization_id", row.organization_id)
        .eq("external_id", row.external_id)
        .maybeSingle();

      if (!message) {
        stillPending++;
        await admin
          .from("whatsapp_inbound_pending")
          .update({
            status: "pending",
            last_error: "aguardando identificação do WhatsApp",
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        continue;
      }

      reconciled++;
      await admin
        .from("whatsapp_inbound_pending")
        .update({
          status: "reconciled",
          reconciled_contact_id: message.contact_id,
          reconciled_conversation_id: message.conversation_id,
          reconciled_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    } catch (error) {
      failed++;
      await admin
        .from("whatsapp_inbound_pending")
        .update({
          status: "failed",
          last_error: error instanceof Error ? error.message.slice(0, 500) : "erro desconhecido",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }
  }

  return { scanned: rows.length, reconciled, still_pending: stillPending, failed };
}

function evolutionIdentityFromPayload(
  parsed: ChatIdentity,
  payload?: WahaPayload,
): ChatIdentity | null {
  if (parsed.kind !== "phone" || payload?.provider !== "evolution") return null;
  const original = payload._data?.original_remote_jid;
  const alternate = payload._data?.remote_jid_alt;
  if (typeof original !== "string" || !original.endsWith("@lid") || typeof alternate !== "string") {
    return null;
  }
  const alternateIdentity = parseChatId(alternate);
  if (alternateIdentity.kind !== "phone" || alternateIdentity.phone !== parsed.phone) return null;
  return { kind: "resolved", phone: parsed.phone, lid: original.replace(/@.*$/, "") };
}

async function resolveLidIdentity(
  session: Session,
  parsed: ChatIdentity,
  payload?: WahaPayload,
): Promise<ChatIdentity> {
  const evolutionIdentity = evolutionIdentityFromPayload(parsed, payload);
  if (evolutionIdentity) return evolutionIdentity;
  if (parsed.kind !== "lid" || !session.waha_session_name) return parsed;
  if (session.provider === "evolution" || payload?.provider === "evolution") return parsed;
  const client = getWahaClient();
  if (!client) return parsed;

  try {
    const phone = await client.getPhoneByLid(session.waha_session_name, parsed.lid);
    return phone ? { kind: "resolved", phone, lid: parsed.lid } : parsed;
  } catch (error) {
    // Enriquecimento nao bloqueia a mensagem: o LID continua valido.
    console.warn("[waha.ingest] LID ainda nao resolvido", {
      session: session.waha_session_name,
      lid: parsed.lid,
      error: error instanceof Error ? error.message : "unknown",
    });
    return parsed;
  }
}

export function verifyHmacSha512(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
  const got = signatureHeader.replace(/^sha512=/i, "").trim();
  if (got.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

function previewFromMessage(p: WahaPayload): string {
  if (p.body) return p.body.slice(0, 280);
  const t = resolveMessageType(p);
  return t !== "text" ? `[${t}]` : "";
}

/** URL da mídia: WAHA novo (payload.media.url) com fallback legado (payload.mediaUrl). */
export function mediaUrlOf(p: WahaPayload): string | null {
  return p.mediaUrl ?? p.media?.url ?? null;
}

/** MIME da mídia: idem (payload.media.mimetype é o campo do NOWEB atual). */
export function mediaMimeOf(p: WahaPayload): string | null {
  return p.mimetype ?? p.media?.mimetype ?? null;
}

/**
 * Mapeia o `type` cru do WAHA NOWEB para o vocabulário de messages.type do CRM
 * (check constraint messages_type_check). WAHA usa `chat` p/ texto, `ptt` p/
 * áudio de voz, `vcard` p/ contato, etc. Sem esse mapa o INSERT viola a
 * constraint e a mensagem some. O type cru fica em metadata.raw_type.
 */
const WA_TYPE_MAP: Record<string, string> = {
  chat: "text",
  text: "text",
  ptt: "audio",
  audio: "audio",
  image: "image",
  video: "video",
  document: "document",
  sticker: "sticker",
  location: "location",
  vcard: "contact",
  contact: "contact",
  multi_vcard: "contact",
  reaction: "reaction",
};

function mapWahaMessageType(raw: string | undefined): string {
  if (!raw) return "text";
  // Fallback "text": só chegamos ao insert com body/mídia presente (guarda acima),
  // então tratar tipo desconhecido como texto não perde a mensagem.
  return WA_TYPE_MAP[raw.toLowerCase()] ?? "text";
}

/**
 * NOWEB (WAHA 2026.x) não envia `type` no payload — o tipo real está nas
 * chaves de `_data.message` (imageMessage, stickerMessage, …). Ordem de
 * resolução: `type` explícito → chave do message → prefixo do MIME → text.
 */
const NOWEB_MESSAGE_KEY_TYPE: Record<string, string> = {
  stickerMessage: "sticker",
  imageMessage: "image",
  videoMessage: "video",
  ptvMessage: "video", // video note (bolinha)
  audioMessage: "audio",
  documentMessage: "document",
  documentWithCaptionMessage: "document",
};

export function resolveMessageType(p: WahaPayload): string {
  if (p.type) return mapWahaMessageType(p.type);
  const msg = p._data?.message;
  if (msg && typeof msg === "object") {
    for (const [key, mapped] of Object.entries(NOWEB_MESSAGE_KEY_TYPE)) {
      if (key in msg) return mapped;
    }
  }
  const mime = mediaMimeOf(p);
  if (mime) {
    if (mime === "image/webp") return "sticker";
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    return "document";
  }
  return "text";
}

function notifyNameOf(p: WahaPayload): string | null {
  return p._data?.notifyName ?? p._data?.pushName ?? null;
}

function exactProviderPhone(chatId: string): string | undefined {
  if (!/@(?:c\.us|s\.whatsapp\.net)$/.test(chatId)) return undefined;
  const digits = chatId.replace(/@.*$/, "").replace(/\D/g, "");
  return digits ? `+${digits}` : undefined;
}

/**
 * Upsert atômico de contato pela identidade canônica. Retorna null se a
 * identidade for de grupo ou a RPC falhar.
 */
async function upsertContact(
  admin: Admin,
  orgId: string,
  parsed: ChatIdentity,
  chatId: string,
  notifyName: string | null,
): Promise<string | null> {
  if (parsed.kind === "group") return null;
  const phone = parsed.kind === "phone" || parsed.kind === "resolved" ? parsed.phone : null;
  // Quando o provedor entregou LID + telefone, a RPC precisa executar mesmo
  // que o contato pelo telefone já exista: é ela que grava o alias durável e
  // permite reprocessar mensagens antigas que ficaram pendentes.
  if (phone && parsed.kind !== "resolved") {
    const identity = await findActiveContactByPhone(
      admin,
      orgId,
      phone,
      exactProviderPhone(chatId),
    );
    if (identity.kind === "ambiguous") {
      console.error("[waha.ingest] identidade de telefone ambigua", {
        organization_id: orgId,
        contact_ids: identity.contactIds,
      });
      return null;
    }
    if (identity.kind === "found") return identity.contactId;
  }
  const { data, error } = await admin.rpc(
    "fn_upsert_wa_contact" as never,
    {
      p_org: orgId,
      p_kind: parsed.kind,
      p_phone: phone,
      p_lid: parsed.kind === "lid" || parsed.kind === "resolved" ? parsed.lid : null,
      p_chat_id: chatId,
      p_notify: notifyName,
    } as never,
  );
  if (error) {
    console.error("[waha.ingest] fn_upsert_wa_contact failed", error.message);
    return null;
  }
  return (data as string) ?? null;
}

async function upsertConversation(
  admin: Admin,
  orgId: string,
  contactId: string,
  sessionId: string,
): Promise<string | null> {
  const { data, error } = await admin.rpc(
    "fn_upsert_wa_conversation" as never,
    {
      p_org: orgId,
      p_contact: contactId,
      p_session: sessionId,
    } as never,
  );
  if (error) {
    console.error("[waha.ingest] fn_upsert_wa_conversation failed", error.message);
    return null;
  }
  return (data as string) ?? null;
}

/**
 * Carimba a conversa com a mensagem que acabou de entrar.
 *
 * ⚠️ FALHA BAIXO, MAS CONTA — e a diferença entre as duas coisas é o motivo
 * desta função existir com corpo próprio. A mensagem JÁ foi inserida quando
 * chegamos aqui; bloquear a ingestão porque o carimbo falhou deixaria o
 * histórico refém de uma coluna derivada. Então não se bloqueia.
 *
 * Mas `console.error` sozinho não é "falhar baixo": ele **não bloqueia e também
 * não conta** (anti-pattern nº 14 do CLAUDE.md, e a mesma doutrina já escrita em
 * `lib/leads/activity-write-failure.ts`). Log de servidor sem destino não vira
 * alerta de ninguém — e o efeito prático é que "a RPC falha às vezes" nunca sai
 * de OPINIÃO para NÚMERO. Em 25/07 isso custou caro: a suspeita de que esta
 * chamada falhava foi levada a sério por horas, e não havia como medi-la porque
 * cada falha tinha sumido no log de um processo que já não existia.
 *
 * O evento é o que torna a pergunta respondível: `select count(*) from event_log
 * where event_type = 'whatsapp.conversation_mark_failed'`.
 */
async function markConversation(
  admin: Admin,
  organizationId: string,
  convId: string,
  direction: "inbound" | "outbound",
  preview: string,
  at: string,
): Promise<void> {
  const { error } = await admin.rpc(
    "fn_mark_conversation_message" as never,
    {
      p_conv: convId,
      p_direction: direction,
      p_preview: preview,
      p_at: at,
    } as never,
  );
  if (!error) return;

  const { error: erroAviso } = await admin.rpc(
    "emit_event" as never,
    {
      p_event_type: "whatsapp.conversation_mark_failed",
      p_entity_kind: "conversation",
      p_entity_id: convId,
      // O preview NÃO entra no payload: ele é o texto da mensagem do cliente, e
      // isto é registro operacional, não cópia de conteúdo. O que se precisa
      // saber para agir é qual conversa, que sentido, e o erro.
      p_payload: { direction, erro: error.message },
      p_metadata: { severity: "warn" },
      p_organization_id: organizationId,
    } as never,
  );

  if (erroAviso) {
    // Segunda linha de defesa: o próprio canal de aviso caiu. Aqui o log do
    // processo é o que sobra — é para ESTE caso que ele existe, não como rotina.
    console.error("[waha.ingest] o carimbo falhou E o aviso também", {
      conversa: convId,
      erro: error.message,
      aviso: erroAviso.message,
    });
  }
}

/**
 * Mensagem recebida (fromMe=false). Contato = remetente (`from`).
 */
async function handleInbound(
  admin: Admin,
  session: Session,
  p: WahaPayload,
  requestId: string,
  reconciling = false,
): Promise<void> {
  const chatId = p.from ?? "";
  const parsed = await resolveLidIdentity(session, parseChatId(chatId), p);
  if (parsed.kind === "group") {
    await handleManagerGroupCommand({
      admin,
      organizationId: session.organization_id,
      sessionId: session.id,
      sessionName: session.external_session_name ?? session.waha_session_name,
      provider: session.provider ?? p.provider ?? "waha",
      groupChatId: chatId,
      senderChatId: p.author ?? p.participant,
      body: p.body,
      externalId: p.id,
      requestId,
    });
    return; // grupos nunca fazem binding CRM nem entram no Inbox comercial
  }
  if (!p.id || !chatId) return;
  // WAHA emite eventos vazios p/ status/read-receipt/presence — não viram mensagem.
  if (!p.body && !mediaUrlOf(p) && !p.hasMedia) return;
  if (parsed.kind === "lid") {
    await preservePendingIdentity(admin, session, p, chatId, parsed.lid, requestId);
    return;
  }

  const contactId = await upsertContact(
    admin,
    session.organization_id,
    parsed,
    chatId,
    notifyNameOf(p),
  );
  if (!contactId) return;
  const conversationId = await upsertConversation(
    admin,
    session.organization_id,
    contactId,
    session.id,
  );
  if (!conversationId) return;

  if (!reconciling && parsed.kind === "resolved") {
    await reconcilePendingIdentity(admin, session, parsed.lid, requestId, parsed.phone);
  }

  const now = new Date().toISOString();
  const { data: insertedMessage, error: insertErr } = await admin
    .from("messages")
    .insert({
      organization_id: session.organization_id,
      conversation_id: conversationId,
      channel_session_id: session.id,
      contact_id: contactId,
      external_id: p.id,
      type: resolveMessageType(p),
      direction: "inbound",
      status: "delivered",
      ack: p.ack ?? null,
      body: p.body ?? null,
      media_url: mediaUrlOf(p),
      media_mime: mediaMimeOf(p),
      sent_via: "external_device",
      sent_at: p.timestamp ? new Date(p.timestamp * 1000).toISOString() : now,
      delivered_at: now,
      metadata: {
        channel_provider: p.provider ?? "waha",
        raw_type: p.type,
        ack_name: p.ackName,
        ...(p._data?.poll_id ? { poll_id: p._data.poll_id } : {}),
        ...(p._data?.poll_vote ? { poll_vote: true } : {}),
      },
    })
    .select("id")
    .maybeSingle();

  // Idempotência: 23505 = unique (organization_id, external_id) já ingerido.
  if (insertErr && insertErr.code !== "23505") {
    console.error("[waha.ingest] message insert failed", insertErr.message);
    return;
  }
  // Mesmo em uma reentrega do webhook, ainda precisamos garantir que o pedido
  // de resposta da IA foi registrado. Antes retornávamos aqui: se a mensagem
  // tinha sido salva mas a emissão do dispatch tivesse falhado, ela aparecia no
  // Inbox sem nunca chegar à fila da IA.
  const inboundMessageId =
    insertedMessage?.id ??
    (
      await admin
        .from("messages")
        .select("id")
        .eq("organization_id", session.organization_id)
        .eq("external_id", p.id)
        .eq("direction", "inbound")
        .maybeSingle()
    ).data?.id;
  if (!inboundMessageId) return;

  await markConversation(
    admin,
    session.organization_id,
    conversationId,
    "inbound",
    previewFromMessage(p),
    now,
  );

  // A resposta encerra a participação deste destinatário na campanha sem
  // disparar novamente nem esperar o restante da conversa. O vínculo é pelo
  // contato/conversa já normalizados pelo mesmo ingest do Inbox.
  await admin.rpc(
    "fn_mark_campaign_recipient_replied" as never,
    {
      p_org: session.organization_id,
      p_contact: contactId,
      p_conversation: conversationId,
    } as never,
  );

  if (p.body && isExplicitStopRequest(p.body)) {
    const { error: blockError } = await admin.rpc(
      "fn_set_contact_communication_status" as never,
      {
        p_contact: contactId,
        p_blocked: true,
        p_reason: "Pedido explícito para interromper mensagens",
        p_source: "whatsapp_stop_keyword",
      } as never,
    );
    if (blockError) {
      console.error("[waha.ingest] central opt-out failed", blockError.message);
      await admin
        .from("contacts")
        .update({ is_blocked: true, blocked_reason: "stop_keyword", blocked_at: now })
        .eq("id", contactId);
    }
    await audit({
      action: "contact.blocked",
      organizationId: session.organization_id,
      resourceType: "contact",
      requestId,
      metadata: { reason: "stop_keyword", contact_id: contactId },
    });
  }

  await audit({
    action: "message.received",
    organizationId: session.organization_id,
    resourceType: "message",
    requestId,
    metadata: { conversation_id: conversationId, type: p.type, external_id: p.id },
  });

  // A emissão para a IA é await + idempotente. Isso faz a rota responder 500
  // em uma falha real, permitindo que a Evolution reentregue o evento; a
  // migration 0117 garante que a reentrega não duplica a resposta.
  // Mensagem histórica reconciliada deve aparecer no Inbox, mas não pode
  // disparar várias respostas atrasadas da IA. A mensagem nova que revelou o
  // vínculo LID continua seguindo o fluxo normal logo depois.
  if (!reconciling) {
    const { error: dispatchError } = await admin.rpc(
      "fn_emit_ai_agent_dispatch_once" as never,
      {
        p_organization_id: session.organization_id,
        p_message_id: inboundMessageId,
        p_conversation_id: conversationId,
        p_contact_id: contactId,
        p_channel_session_id: session.id,
        p_metadata: { source: "whatsapp_webhook", request_id: requestId },
      } as never,
    );
    if (dispatchError) {
      throw new Error(`ai_dispatch_emit_failed:${dispatchError.message}`);
    }
  }

  if (!insertErr) {
    await admin.rpc(
      "emit_event" as never,
      {
        p_event_type: "message.received",
        p_entity_kind: "message",
        p_entity_id: inboundMessageId,
        p_payload: {
          conversation_id: conversationId,
          contact_id: contactId,
          channel_session_id: session.id,
          body_preview: (p.body ?? "").slice(0, 280),
        },
        p_metadata: { source: "waha_webhook", request_id: requestId },
        p_organization_id: session.organization_id,
      } as never,
    );

    if (mediaUrlOf(p)) {
      admin
        .rpc(
          "emit_event" as never,
          {
            p_event_type: "media.persist_requested",
            p_entity_kind: "message",
            p_entity_id: inboundMessageId,
            p_payload: { message_id: inboundMessageId, conversation_id: conversationId },
            p_metadata: { source: "waha_webhook", request_id: requestId },
            p_organization_id: session.organization_id,
          } as never,
        )
        .then(({ error }) => {
          if (error)
            console.error("[waha.ingest] emit media.persist_requested failed", error.message);
        });
    }
  }
}

/**
 * fromMe=true: operador respondeu direto do WhatsApp dele (não pelo composer).
 * Contato = destinatário (`to`). `from` é o próprio número do operador — nunca
 * vira contato. Registrado como outbound p/ o operador ver o histórico completo.
 */
async function handleOutboundFromUserPhone(
  admin: Admin,
  session: Session,
  p: WahaPayload,
  requestId: string,
): Promise<void> {
  const chatId = outboundChatIdOf(p);
  const parsed = await resolveLidIdentity(session, parseChatId(chatId), p);
  if (parsed.kind === "group") return;
  if (!p.id || !chatId) return;
  if (!p.body && !mediaUrlOf(p) && !p.hasMedia) return;

  const contactId = await upsertContact(
    admin,
    session.organization_id,
    parsed,
    chatId,
    notifyNameOf(p),
  );
  if (!contactId) return;
  const conversationId = await upsertConversation(
    admin,
    session.organization_id,
    contactId,
    session.id,
  );
  if (!conversationId) return;

  const now = new Date().toISOString();
  const { data: insertedOutbound, error: insertErr } = await admin
    .from("messages")
    .insert({
      organization_id: session.organization_id,
      conversation_id: conversationId,
      channel_session_id: session.id,
      contact_id: contactId,
      external_id: p.id,
      type: resolveMessageType(p),
      direction: "outbound",
      status: "sent",
      ack: p.ack ?? null,
      body: p.body ?? null,
      media_url: mediaUrlOf(p),
      media_mime: mediaMimeOf(p),
      sent_via: "external_device",
      sent_at: p.timestamp ? new Date(p.timestamp * 1000).toISOString() : now,
      metadata: { channel_provider: p.provider ?? "waha", raw_type: p.type, fromMe: true },
    })
    .select("id")
    .maybeSingle();
  if (insertErr && insertErr.code !== "23505") {
    console.error("[waha.ingest] outbound insert failed", insertErr.message);
    return;
  }
  if (insertErr?.code === "23505") return;

  await markConversation(
    admin,
    session.organization_id,
    conversationId,
    "outbound",
    previewFromMessage(p),
    now,
  );

  await audit({
    action: "message.sent",
    organizationId: session.organization_id,
    resourceType: "message",
    requestId,
    metadata: {
      conversation_id: conversationId,
      type: p.type,
      external_id: p.id,
      from_user_phone: true,
    },
  });

  if (insertedOutbound?.id && mediaUrlOf(p)) {
    admin
      .rpc(
        "emit_event" as never,
        {
          p_event_type: "media.persist_requested",
          p_entity_kind: "message",
          p_entity_id: insertedOutbound.id,
          p_payload: { message_id: insertedOutbound.id, conversation_id: conversationId },
          p_metadata: { source: "waha_webhook", request_id: requestId },
          p_organization_id: session.organization_id,
        } as never,
      )
      .then(({ error }) => {
        if (error)
          console.error("[waha.ingest] emit media.persist_requested failed", error.message);
      });
  }
}

async function handleAck(admin: Admin, session: Session, p: WahaPayload): Promise<void> {
  if (!p.id) return;
  const ack = p.ack ?? 0;
  const status = ackToStatus(ack);
  const now = new Date().toISOString();

  const update: Record<string, unknown> = { ack, status };
  if (ack >= 2) update.delivered_at = now;
  if (ack >= 3) update.read_at = now;

  // O ack do WAHA 2026.x vem como `{fromMe}_{chatId}_{bareId}`. O NOWEB grava
  // `external_id` = bareId (id interno), o WEBJS grava o `_serialized` completo.
  // Casar as duas formas cobre ambos os engines sem tocar no external_id de
  // inbound (que é full e sustenta o dedup 23505).
  const bare = bareWaMessageId(p.id);
  const candidates = bare === p.id ? [p.id] : [p.id, bare];
  await admin
    .from("messages")
    .update(update)
    .eq("organization_id", session.organization_id)
    .in("external_id", candidates);
}

interface SessionStatusRow extends Session {
  is_warmup_complete: boolean | null;
  warmup_started_at: string | null;
}

async function handleSessionStatus(
  admin: Admin,
  session: SessionStatusRow,
  p: WahaPayload,
): Promise<void> {
  const status = (p.status ?? "").toUpperCase() || null;
  if (!status) return;
  const allowed = new Set(["STARTING", "SCAN_QR_CODE", "WORKING", "STOPPED", "FAILED"]);
  if (!allowed.has(status)) return;
  const now = new Date().toISOString();

  const update: Record<string, unknown> = { status, last_status_change_at: now };
  if (status === "WORKING" && session.warmup_started_at && !session.is_warmup_complete) {
    update.is_warmup_complete = true;
    update.warmup_completed_at = now;
  }
  await admin.from("channel_sessions").update(update).eq("id", session.id);
}

/**
 * Roteador único de eventos WAHA. Os dois route handlers convergem aqui após
 * resolver a sessão e validar HMAC.
 */
export async function dispatchWahaEvent(
  admin: Admin,
  session: SessionStatusRow,
  envelope: WahaEnvelope,
  requestId: string,
): Promise<void> {
  const eventType = envelope.event ?? "unknown";
  const payload = envelope.payload ?? {};

  if (eventType === "message" || eventType === "message.any") {
    if (payload.fromMe) {
      await handleOutboundFromUserPhone(admin, session, payload, requestId);
    } else {
      await handleInbound(admin, session, payload, requestId);
    }
  } else if (eventType === "poll.vote" || eventType === "poll.vote.failed") {
    const vote = payload.vote;
    const options = vote?.selectedOptions ?? [];
    if (vote && options.length > 0) {
      await handleInbound(
        admin,
        session,
        {
          id: vote.id,
          from: vote.from,
          to: vote.to,
          fromMe: vote.fromMe,
          body: options.join(", "),
          type: "text",
          timestamp: vote.timestamp,
          _data: { poll_vote: true, poll_id: payload.poll?.id ?? null },
        },
        requestId,
      );
    }
  } else if (eventType === "message.ack") {
    await handleAck(admin, session, payload);
  } else if (eventType === "session.status" || eventType === "state.change") {
    await handleSessionStatus(admin, session, payload);
  }
}
