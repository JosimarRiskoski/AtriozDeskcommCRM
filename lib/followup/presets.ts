import type { FlowGraph } from "./graph-schema";

export const FOLLOWUP_PRESET_IDS = [
  "no_response",
  "proposal",
  "quote",
  "document",
  "post_sale",
  "appointment",
  "blank",
] as const;

export type FollowupPresetId = (typeof FOLLOWUP_PRESET_IDS)[number];

export interface FollowupPresetDefinition {
  id: FollowupPresetId;
  name: string;
  description: string;
  suggestedName: string;
}

export const FOLLOWUP_PRESETS: FollowupPresetDefinition[] = [
  {
    id: "no_response",
    name: "Recuperar contato sem resposta",
    description: "Duas tentativas cordiais e encerra automaticamente se a pessoa responder.",
    suggestedName: "Recuperação de contato sem resposta",
  },
  {
    id: "proposal",
    name: "Acompanhar proposta",
    description: "Retoma uma proposta enviada, oferece ajuda e evita pressão comercial.",
    suggestedName: "Acompanhamento de proposta",
  },
  {
    id: "quote",
    name: "Retomar orçamento",
    description: "Confirma se o orçamento foi analisado e abre espaço para dúvidas.",
    suggestedName: "Retomada de orçamento",
  },
  {
    id: "document",
    name: "Solicitar documento pendente",
    description: "Lembra o contato do documento necessário e oferece atendimento humano.",
    suggestedName: "Documento pendente",
  },
  {
    id: "post_sale",
    name: "Pós-venda",
    description: "Confere se deu tudo certo e mantém o relacionamento depois da venda.",
    suggestedName: "Acompanhamento pós-venda",
  },
  {
    id: "appointment",
    name: "Confirmar agendamento",
    description: "Confirma o compromisso e orienta como remarcar, se necessário.",
    suggestedName: "Confirmação de agendamento",
  },
  {
    id: "blank",
    name: "Começar do zero",
    description: "Cria somente o início e o fim para montagem no editor avançado.",
    suggestedName: "Novo fluxo personalizado",
  },
];

const COPY: Record<Exclude<FollowupPresetId, "blank">, [string, string]> = {
  no_response: [
    "Retome a conversa com cordialidade, mencione o assunto anterior sem pressionar e pergunte se a pessoa ainda deseja ajuda.",
    "Faça uma última tentativa breve e respeitosa. Diga que ficará à disposição e não crie urgência artificial.",
  ],
  proposal: [
    "Pergunte se a pessoa conseguiu analisar a proposta e se existe alguma dúvida que você possa esclarecer.",
    "Retome a proposta de forma breve, ofereça ajuda humana e respeite a decisão da pessoa sem pressionar.",
  ],
  quote: [
    "Pergunte se a pessoa conseguiu avaliar o orçamento e se deseja esclarecer valores, prazos ou condições.",
    "Faça uma última retomada gentil do orçamento e informe que a equipe continua disponível.",
  ],
  document: [
    "Lembre com clareza qual documento ainda é necessário e explique em uma frase por que ele é importante.",
    "Reforce a solicitação do documento sem cobrança e ofereça ajuda humana caso a pessoa tenha dificuldade para enviar.",
  ],
  post_sale: [
    "Pergunte se ocorreu tudo bem após a contratação e se a pessoa precisa de algum apoio.",
    "Faça um acompanhamento final, agradeça a confiança e deixe o canal aberto para suporte.",
  ],
  appointment: [
    "Confirme o agendamento de forma objetiva, mencionando que a pessoa pode avisar se precisar remarcar.",
    "Envie um lembrete breve e cordial do compromisso, sem inventar data ou horário que não esteja no contexto.",
  ],
};

function nodeId(prefix: string, index: number) {
  return `${prefix}-${index}`;
}

export function buildFollowupPresetGraph(id: FollowupPresetId): FlowGraph {
  if (id === "blank") {
    return {
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          label: "Início do fluxo",
          position: { x: 120, y: 80 },
          config: {},
        },
        {
          id: "end-1",
          type: "end",
          label: "Fim do fluxo",
          position: { x: 120, y: 300 },
          config: { outcome: "exhausted" },
        },
      ],
      edges: [
        {
          id: "edge-1",
          source: "trigger-1",
          target: "end-1",
          priority: 0,
          condition: { type: "always" },
        },
      ],
    };
  }

  const [firstMessage, secondMessage] = COPY[id];
  // The current engine requires a deterministic fallback template once the
  // accumulated wait reaches 24h. Ready-made presets deliberately stay below
  // that boundary so they can be published immediately without hidden DB ids.
  const waits =
    id === "appointment" ? [60, 120] : id === "post_sale" ? [360, 600] : [120, 600];
  const nodes: FlowGraph["nodes"] = [
    {
      id: nodeId("trigger", 1),
      type: "trigger",
      label: "Início do fluxo",
      position: { x: 120, y: 40 },
      config: {},
    },
    {
      id: nodeId("wait", 1),
      type: "wait",
      label: "Aguardar antes da 1ª mensagem",
      position: { x: 120, y: 180 },
      config: { mode: "fixed", duration_ms: waits[0]! * 60_000 },
    },
    {
      id: nodeId("action", 1),
      type: "action",
      label: "Primeira mensagem",
      position: { x: 120, y: 320 },
      config: { mode: "ai_message", prompt_hint: firstMessage },
    },
    {
      id: nodeId("wait", 2),
      type: "wait",
      label: "Aguardar antes da 2ª mensagem",
      position: { x: 120, y: 460 },
      config: { mode: "fixed", duration_ms: waits[1]! * 60_000 },
    },
    {
      id: nodeId("action", 2),
      type: "action",
      label: "Segunda mensagem",
      position: { x: 120, y: 600 },
      config: { mode: "ai_message", prompt_hint: secondMessage },
    },
    {
      id: nodeId("end", 1),
      type: "end",
      label: "Encerrar tentativas",
      position: { x: 120, y: 740 },
      config: { outcome: "exhausted" },
    },
  ];
  const edges: FlowGraph["edges"] = nodes.slice(0, -1).map((node, index) => ({
    id: nodeId("edge", index + 1),
    source: node.id,
    target: nodes[index + 1]!.id,
    priority: 0,
    condition: { type: "always" },
  }));
  return { nodes, edges };
}

export function isFollowupPresetId(value: string): value is FollowupPresetId {
  return (FOLLOWUP_PRESET_IDS as readonly string[]).includes(value);
}
