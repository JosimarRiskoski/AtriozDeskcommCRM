export type FailureCategory =
  | "conexao"
  | "telefone"
  | "consentimento_bloqueio"
  | "mensagem"
  | "midia_documento"
  | "ia"
  | "integracao"
  | "timeout"
  | "erro_interno";

export const FAILURE_CATEGORY_LABELS: Record<FailureCategory, string> = {
  conexao: "Conexão",
  telefone: "Telefone",
  consentimento_bloqueio: "Consentimento ou bloqueio",
  mensagem: "Mensagem",
  midia_documento: "Mídia ou documento",
  ia: "IA",
  integracao: "Integração",
  timeout: "Tempo esgotado",
  erro_interno: "Erro interno",
};

export function classifyFailure(
  code: string | null,
  message: string | null,
  module: string,
): FailureCategory {
  const value = `${code ?? ""} ${message ?? ""} ${module}`.toLowerCase();
  if (/connection|channel|session|evolution|socket|econn|network/.test(value)) return "conexao";
  if (/phone|number|whatsapp|chat_id|jid|lid/.test(value)) return "telefone";
  if (/consent|blocked|opt.?out|suppression|exclu/.test(value)) return "consentimento_bloqueio";
  if (/media|audio|image|video|document|storage|arquivo/.test(value)) return "midia_documento";
  if (/timeout|timed.?out|lease/.test(value)) return "timeout";
  if (/agent|ai_|llm|model|token|rag|embedding|\bia\b/.test(value)) return "ia";
  if (/webhook|integration|api|oauth|3c|meta|nuvemshop/.test(value)) return "integracao";
  if (/message|send|template|delivery/.test(value)) return "mensagem";
  return "erro_interno";
}

export function understandableFailure(category: FailureCategory, raw: string | null): string {
  if (raw && !/^[a-z0-9_.:-]+$/i.test(raw.trim())) return raw.trim().slice(0, 300);
  return {
    conexao: "A conexão não estava disponível para concluir a operação.",
    telefone: "O telefone não pôde ser validado ou localizado no WhatsApp.",
    consentimento_bloqueio: "O contato não está autorizado a receber esta comunicação.",
    mensagem: "A mensagem não foi aceita ou entregue pelo provedor.",
    midia_documento: "A mídia ou o documento não pôde ser preparado ou enviado.",
    ia: "A IA não conseguiu concluir o processamento.",
    integracao: "O serviço integrado recusou ou não concluiu a solicitação.",
    timeout: "A operação demorou além do limite configurado.",
    erro_interno: "O sistema não conseguiu concluir a operação.",
  }[category];
}

export function failureRecommendation(category: FailureCategory): string {
  return {
    conexao: "Confira a saúde da conexão e tente novamente depois de reconectá-la.",
    telefone: "Revise o número e confirme se ele possui WhatsApp.",
    consentimento_bloqueio:
      "Abra Comunicação e privacidade no contato antes de qualquer nova tentativa.",
    mensagem: "Revise o conteúdo e tente novamente; se persistir, consulte o provedor.",
    midia_documento: "Confirme formato, tamanho e disponibilidade do arquivo.",
    ia: "Confira agente, limite de consumo, credencial e base de conhecimento.",
    integracao: "Confira credencial, assinatura, permissões e disponibilidade da integração.",
    timeout: "Tente novamente e verifique a disponibilidade do serviço envolvido.",
    erro_interno:
      "Use o identificador técnico para localizar o evento e acione o suporte se repetir.",
  }[category];
}
