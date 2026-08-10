/**
 * Adapter WhatsApp-via-CRM. O transporte concreto é resolvido pelo CRM e, na
 * instalação atual, usa exclusivamente a Evolution API.
 * reescreve) o sink idempotente F2-06 (send-message.ts) e o espelho de saúde do
 * watchdog F2-14 (session-watchdog.ts). É o único ponto do daemon que fala com a
 * borda concreta do canal; o runtime/guardrails só enxergam a interface
 * ChannelAdapter (gate: scripts/lint-channel-adapter.ts).
 *
 * A migração para a WhatsApp Cloud API cria um novo adapter aqui e troca o
 * registro — o runtime não muda (prova: daemon/test/channel-adapter.test.ts). O
 * mapa método-a-método e os pré-requisitos estão em
 * docs/architecture/channel-adapter.md.
 */
import type pg from 'pg';

import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelCost,
  ChannelSendInput,
  ChannelSendResult,
  ChannelSessionHealth,
} from '../../channel-adapter';

import { CrmTransportError, type CrmEdgeConfig } from '../crm/mcp-client';
import { sendTurnMessage, SendToolError } from '../crm/send-message';
import { SESSION_HEALTHY_STATUS } from '../crm/session-watchdog';

/** Identificador estável do canal entregue pelo sink idempotente do CRM. */
export const CRM_WHATSAPP_CHANNEL = 'whatsapp_via_crm';

export class CrmWhatsAppChannelAdapter implements ChannelAdapter {
  readonly channel = CRM_WHATSAPP_CHANNEL;
  // Campos declarados + atribuídos no corpo (não parameter properties): o daemon
  // roda em `node --experimental-strip-types` (strip-only), que não transforma.
  private readonly db: pg.Pool;
  private readonly crmCfg: CrmEdgeConfig;

  constructor(db: pg.Pool, crmCfg: CrmEdgeConfig) {
    this.db = db;
    this.crmCfg = crmCfg;
  }

  async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    try {
      const outcome = await sendTurnMessage(this.db, this.crmCfg, input);
      switch (outcome.kind) {
        case 'sent':
          return { kind: 'sent', idempotencyKey: outcome.idempotencyKey, messageId: outcome.crmMessageId };
        case 'already_sent':
          return { kind: 'already_sent', idempotencyKey: outcome.idempotencyKey, messageId: outcome.crmMessageId };
        case 'queued':
          return { kind: 'queued', idempotencyKey: outcome.idempotencyKey, messageId: outcome.crmMessageId };
        case 'blocked':
          return { kind: 'blocked', idempotencyKey: outcome.idempotencyKey };
        case 'failed':
          return { kind: 'failed', idempotencyKey: outcome.idempotencyKey, messageId: outcome.crmMessageId };
      }
    } catch (err) {
      // Transporte/tool do CRM é transiente por contrato do sink (o ledger fica
      // 'requested' e o replay com a MESMA key dedupa — F2-06) → vira
      // 'unavailable', nunca exceção pro runtime. O reason não carrega PII (é só
      // o nome da classe de erro). Erro de PROGRAMAÇÃO propaga (bug, não retry).
      if (err instanceof CrmTransportError || err instanceof SendToolError) {
        return { kind: 'unavailable', reason: err.name };
      }
      throw err;
    }
  }

  async sessionHealth(channelSessionId: string): Promise<ChannelSessionHealth> {
    // O message-plane nunca fala diretamente com o provedor — lê o espelho durável
    // que o watchdog (F2-14) mantém a partir do CRM. channel_session_id é um UUID
    // do CRM, globalmente único; sem linha no espelho = ainda não observada.
    const { rows } = await this.db.query<{ status: string; changed_at: string | null }>(
      `select status, status_changed_at::text as changed_at
       from channel_session_health where channel_session_id = $1`,
      [channelSessionId],
    );
    const row = rows[0];
    if (row === undefined) {
      return { healthy: false, status: 'unknown', since: null };
    }
    return {
      healthy: row.status === SESSION_HEALTHY_STATUS,
      status: row.status,
      since: row.changed_at ? new Date(row.changed_at).getTime() : null,
    };
  }

  capabilities(): ChannelCapabilities {
    // A conexão Evolution usada pelo CRM aceita texto livre a qualquer hora.
    return { freeformAnytime: true, serviceWindowHours: null };
  }

  costPerMessage(): ChannelCost {
    // Evolution é custo flat de infraestrutura, sem custo por mensagem no adapter.
    return { perMessageUsdCents: 0, model: 'flat' };
  }
}
