export function metaCapiErrorLabel(error: string | null | undefined) {
  if (!error) return "A Meta nao informou o motivo da falha.";
  if (error.includes("meta_http_400"))
    return "A Meta rejeitou os dados do evento. Revise o evento, o valor e os dados de correspondencia.";
  if (error.includes("meta_http_401")) return "O token da Meta e invalido ou expirou.";
  if (error.includes("meta_http_403"))
    return "O token nao possui permissao para enviar eventos a este Dataset.";
  if (error.includes("meta_http_429"))
    return "A Meta limitou temporariamente os envios. Tente novamente em alguns minutos.";
  if (error.includes("meta_token_unavailable"))
    return "A credencial da Meta nao pode ser lida. Salve o token novamente.";
  if (error.includes("consent_missing"))
    return "Falta consentimento para compartilhar esta conversao.";
  if (error.includes("matching_data_missing"))
    return "Faltam telefone ou e-mail para correspondencia.";
  if (error.includes("conversion_already_sent_for_lead"))
    return "Esta oportunidade ja possui uma conversao enviada.";
  return "A conversao nao foi aceita pela Meta. Abra as configuracoes para revisar a integracao.";
}
