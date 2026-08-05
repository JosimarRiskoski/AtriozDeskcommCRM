/**
 * Config do agente por PONTEIRO PUBLICADO (Fase 2B da fusão) — a tela
 * app/app/ai/agents/[id] é a fonte de verdade da config do agente.
 *
 * Contrato:
 *   - resolvida no início de CADA turno (zero cache de processo): publicar na
 *     tela ⇒ o PRÓXIMO turno já usa a versão nova;
 *   - a versão publicada é imutável no banco (trigger da 0051) — mesma garantia
 *     versões-imutáveis+ponteiro do harness (0050);
 *   - seleção espelha o dispatcher do CRM: org + não-arquivado + published_version_id
 *     preenchido + binding da channel_session do job, ordenado por priority desc;
 *   - org e channel_session vêm de fonte confiável (row do job), nunca de payload;
 *   - sem agente publicado para a sessão ⇒ null (o turno cai no comportamento
 *     de fallback: playbook por ponteiro + settings.llm da org + knobs de env).
 */
import type pg from "pg";

export interface PublishedAgentConfig {
  agentId: string;
  versionId: string;
  agentName: string;
  systemPrompt: string;
  provider: string;
  model: string;
  credentialId: string | null;
  maxSteps: number;
  historyMessageWindow: number;
  historyTokenWindow: number;
  handoffKeywords: string[];
  handoffToolEnabled: boolean;
  splitMessages: boolean;
  splitMaxChars: number;
  /** input multimodal (imagem/áudio/pdf) habilitado no turno (Onda 3). */
  multimodalInput: boolean;
  /** tools open_human_case/provide_case_update habilitadas no turno (spec 15). */
  casesEnabled: boolean;
  /** tool_ids do catálogo MCP habilitadas na tela (2B-tools). */
  toolIds: string[];
  /** Acesso comercial por campo: none, read ou write. */
  contactFieldAccess: Record<string, "none" | "read" | "write">;
  /** KB ativa do agente (ai_agents.active_kb_version_id) — null = sem RAG. */
  activeKbVersionId: string | null;
  /** knobs de RAG do ai_agents.config (defaults do guardrails-schema: 5 / 0.72). */
  ragTopK: number;
  ragSimilarityThreshold: number;
  knowledgeBaseEnabled?: boolean;
  externalInternetAllowed?: boolean;
  forbiddenTopics?: string[];
  humanRequiredTopics?: string[];
  fixedResponses?: Array<{ topic: string; response: string }>;
  fallbackMessage?: string;
  dailyBudgetCents?: number;
  monthlyBudgetCents?: number;
  /** criadores (p/ mint do token efêmero de audit — padrão do runtime nativo). */
  versionCreatedBy: string | null;
  agentCreatedBy: string | null;
}

interface Row {
  agent_id: string;
  version_id: string;
  agent_name: string;
  system_prompt: string;
  provider: string;
  model: string;
  credential_id: string | null;
  max_steps: number;
  history_message_window: number;
  history_token_window: number;
  handoff_keywords: string[] | null;
  handoff_tool_enabled: boolean;
  split_messages: boolean;
  split_max_chars: number;
  multimodal_input: boolean;
  cases_enabled: boolean;
  tool_ids: string[] | null;
  contact_field_access: Record<string, "none" | "read" | "write"> | null;
  active_kb_version_id: string | null;
  config: Record<string, unknown> | null;
  version_created_by: string | null;
  agent_created_by: string | null;
  selection_mode: "manual" | "connection" | "origin" | "stage";
  selection_reason: string;
  organization_handoff_rules: Record<string, unknown> | null;
}

export async function loadPublishedAgentConfig(
  db: pg.Pool,
  organizationId: string,
  channelSessionId: string,
  conversationId?: string | null,
): Promise<PublishedAgentConfig | null> {
  const { rows } = await db.query<Row>(
    `with conversation_context as (
       select c.selected_agent_id,
              c.assignee_kind = 'user' as human_attending,
              c.channel_session_id,
              ct.source as contact_source,
              (select l.stage_id from crm_leads l
               where l.organization_id = c.organization_id and l.contact_id = c.contact_id
                 and l.status = 'open'
               order by l.last_activity_at desc nulls last, l.created_at desc
               limit 1) as stage_id
       from conversations c
       join contacts ct on ct.id = c.contact_id and ct.organization_id = c.organization_id
       where c.id = $3 and c.organization_id = $1
     ), matched_rule as (
       select r.agent_id, r.name, r.channel_session_id, r.contact_source, r.stage_id
       from ai_agent_assignment_rules r, conversation_context cc
       where r.organization_id = $1 and r.is_active
         and (r.channel_session_id is null or r.channel_session_id = cc.channel_session_id)
         and (r.contact_source is null or lower(r.contact_source) = lower(coalesce(cc.contact_source, '')))
         and (r.stage_id is null or (r.allow_stage_switch and r.stage_id = cc.stage_id))
       order by
         ((r.channel_session_id is not null)::int + (r.contact_source is not null)::int + (r.stage_id is not null)::int) desc,
         r.priority desc, r.created_at asc
       limit 1
     ), agent_choice as (
       select coalesce(
         (select selected_agent_id from conversation_context),
         (select agent_id from matched_rule)
       ) as agent_id
     )
     select a.id as agent_id,
            v.id as version_id,
            a.name as agent_name,
            v.system_prompt,
            v.provider,
            v.model,
            v.credential_id,
            v.max_steps,
            v.history_message_window,
            v.history_token_window,
            v.handoff_keywords,
            v.handoff_tool_enabled,
            v.split_messages,
            v.split_max_chars,
            v.multimodal_input,
            v.cases_enabled,
            v.tool_ids,
            v.contact_field_access,
            a.active_kb_version_id,
            a.config,
            (select hs.handoff_rules from human_support_settings hs where hs.organization_id = a.organization_id) as organization_handoff_rules,
            case
              when a.id = (select selected_agent_id from conversation_context) then 'manual'
              when (select stage_id from matched_rule) is not null then 'stage'
              when (select contact_source from matched_rule) is not null then 'origin'
              else 'connection'
            end as selection_mode,
            case
              when a.id = (select selected_agent_id from conversation_context) then 'Escolha manual registrada no Inbox'
              when (select name from matched_rule) is not null then 'Regra automática: ' || (select name from matched_rule)
              else 'Agente padrão da conexão'
            end as selection_reason,
            v.created_by as version_created_by,
            a.created_by as agent_created_by
     from ai_agents a
     join ai_agent_versions v on v.id = a.published_version_id
     where a.organization_id = $1
       and a.archived_at is null
       -- is_active é semântica do rag_bot legado; para mcp_agent "ativo" =
       -- published_version_id preenchido + não arquivado (mesmo critério do
       -- dispatcher nativo do CRM — pausar = despublicar).
       and v.status = 'published'
       and coalesce((select not human_attending from conversation_context), true)
       and (
         ((select agent_id from agent_choice) is not null
           and a.id = (select agent_id from agent_choice))
         or
         ((select agent_id from agent_choice) is null
           and v.channel_session_id = $2)
       )
     order by
       case when a.id = (select agent_id from agent_choice) then 0 else 1 end,
       case when (select agent_id from agent_choice) is null and a.is_default then 0 else 1 end,
       a.priority desc, a.created_at asc
     limit 1`,
    [organizationId, channelSessionId, conversationId ?? null],
  );
  const r = rows[0];
  if (r === undefined) return null;

  if (conversationId) {
    await db.query(
      `with previous as (
         select effective_agent_id from conversations
         where id = $2 and organization_id = $1 for update
       ), changed as (
         update conversations c
         set effective_agent_id = $3, effective_agent_reason = $5, effective_agent_at = now()
         from previous p
         where c.id = $2 and c.organization_id = $1
           and c.effective_agent_id is distinct from $3::uuid
         returning p.effective_agent_id
       )
       insert into conversation_agent_events
         (organization_id, conversation_id, from_agent_id, to_agent_id, selection_mode, reason)
       select $1, $2, effective_agent_id, $3, $4, $5 from changed`,
      [organizationId, conversationId, r.agent_id, r.selection_mode, r.selection_reason],
    );
  }

  const cfg = (r.config ?? {}) as Record<string, unknown>;
  const orgRules = (r.organization_handoff_rules ?? {}) as Record<string, unknown>;
  const ragTopK =
    typeof cfg.rag_top_k === "number" &&
    Number.isInteger(cfg.rag_top_k) &&
    cfg.rag_top_k >= 1 &&
    cfg.rag_top_k <= 20
      ? cfg.rag_top_k
      : 5;
  const ragSimilarityThreshold =
    typeof cfg.rag_similarity_threshold === "number" &&
    cfg.rag_similarity_threshold >= 0 &&
    cfg.rag_similarity_threshold <= 1
      ? cfg.rag_similarity_threshold
      : 0.72;
  const stringList = (value: unknown): string[] =>
    Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === "string" && item.trim() !== "")
          .map((item) => item.trim())
      : [];
  const orgHumanTopics = [
    ...stringList(orgRules.required_document_types),
    ...stringList(orgRules.custom_intents),
  ];
  const fixedResponses = Array.isArray(cfg.fixed_responses)
    ? cfg.fixed_responses.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as { topic?: unknown; response?: unknown };
        return typeof row.topic === "string" &&
          typeof row.response === "string" &&
          row.topic.trim() &&
          row.response.trim()
          ? [{ topic: row.topic.trim(), response: row.response.trim() }]
          : [];
      })
    : [];
  const cents = (value: unknown): number =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;

  return {
    agentId: r.agent_id,
    versionId: r.version_id,
    agentName: r.agent_name,
    systemPrompt: r.system_prompt,
    provider: r.provider,
    model: r.model,
    credentialId: r.credential_id,
    maxSteps: r.max_steps,
    historyMessageWindow: r.history_message_window,
    historyTokenWindow: r.history_token_window,
    handoffKeywords: (r.handoff_keywords ?? [])
      .map((k) => k.toLowerCase().trim())
      .filter((k) => k !== ""),
    handoffToolEnabled: r.handoff_tool_enabled,
    splitMessages: r.split_messages,
    splitMaxChars: r.split_max_chars,
    multimodalInput: r.multimodal_input,
    casesEnabled: r.cases_enabled,
    toolIds: r.tool_ids ?? [],
    contactFieldAccess: r.contact_field_access ?? {},
    activeKbVersionId: r.active_kb_version_id,
    ragTopK,
    ragSimilarityThreshold,
    knowledgeBaseEnabled: cfg.knowledge_base_enabled !== false,
    externalInternetAllowed: cfg.external_internet_allowed === true,
    forbiddenTopics: stringList(cfg.forbidden_topics),
    humanRequiredTopics: Array.from(new Set([...stringList(cfg.human_required_topics), ...orgHumanTopics])),
    fixedResponses,
    fallbackMessage:
      typeof cfg.fallback_message === "string" && cfg.fallback_message.trim()
        ? cfg.fallback_message.trim()
        : "Não encontrei essa informação na base autorizada. Vou encaminhar para uma pessoa.",
    dailyBudgetCents: cents(cfg.daily_budget_cents),
    monthlyBudgetCents: cents(cfg.monthly_budget_cents),
    versionCreatedBy: r.version_created_by,
    agentCreatedBy: r.agent_created_by,
  };
}

/**
 * Detecção de handoff por keywords CONFIGURADAS na tela (soma-se à detecção
 * determinística regex do engine — nunca a substitui). Case-insensitive,
 * substring simples: a semântica do EPIC-13 (sentinel de handoff_keywords).
 */
export function matchesHandoffKeyword(signal: string, keywords: readonly string[]): boolean {
  if (keywords.length === 0) return false;
  const lower = signal.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

export function renderAgentControlPolicy(config: PublishedAgentConfig): string {
  const forbiddenTopics = config.forbiddenTopics ?? [];
  const fixedResponses = config.fixedResponses ?? [];
  const fallbackMessage =
    config.fallbackMessage ?? "Não encontrei essa informação na base autorizada.";
  const lines = [
    "## Limites obrigatórios deste agente",
    config.externalInternetAllowed
      ? "Use somente as ferramentas explicitamente habilitadas; acesso externo é permitido apenas por elas."
      : "Não busque nem use informações da internet externa.",
    `Quando a informação não estiver nas fontes autorizadas, responda exatamente: “${fallbackMessage}”`,
    "Nunca invente preços, políticas, prazos, disponibilidade ou fatos ausentes.",
  ];
  if (forbiddenTopics.length > 0) {
    lines.push(`Assuntos proibidos: ${forbiddenTopics.join("; ")}. Não responda sobre eles.`);
  }
  if (fixedResponses.length > 0) {
    lines.push("Respostas fixas obrigatórias:");
    for (const item of fixedResponses) lines.push(`- ${item.topic}: ${item.response}`);
  }
  return lines.join("\n");
}
