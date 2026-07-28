# Auditoria do roadmap Atrioz DeskcommCRM

Data da auditoria local: 28/07/2026

Branch auditada: `codex/roadmap-fundacoes`

Plano de referência: `PLANO_MELHORIAS_DESKCOMMCRM_MODULO_POR_MODULO.md`

## Como interpretar o status

- **Implementado e validado localmente**: código presente, testes/tipos/lint aplicáveis aprovados e build de produção concluído.
- **Implementado, depende do Supabase**: interface e servidor existem, mas o ambiente só funcionará depois das migrations.
- **Depende de homologação ao vivo**: exige WhatsApp, provedores, credenciais ou evento externo real.
- **Aguardando aprovação visual**: propositalmente não aplicado ao sistema inteiro.
- **Oculto / fora desta fase**: decisão de produto registrada no plano.

## Resultado por módulo

| Plano | Situação comprovada no código | Evidência principal | Próxima prova necessária |
| --- | --- | --- | --- |
| 4.1 Navegação global | Implementado e validado localmente | `components/shell/BackNavigation.tsx`, breadcrumbs, pesquisa global | Conferir retorno preservando filtros nas jornadas reais |
| 4.2 Inbox | Implementado e validado localmente | rolagem interna, respostas prontas, controle de IA por contato e cabeçalho fixo | Testar com muitas mensagens, zoom e celular |
| 4.3 Radar | Implementado, depende do Supabase | filtros por atendente e conexão WhatsApp | Provar isolamento entre organizações com dados reais |
| 4.4 Conexões | Código existente preservado | WAHA, reconexão e proteção de envio | Testar queda, reconexão e proteção com número controlado |
| 4.5 Kanban, funis e etapas | Implementado, depende do Supabase | administração visual de pipeline/etapas, reordenação e ganho/perda | Aplicar migration e mover cartões reais |
| 4.6 Contatos | Implementado, depende do Supabase | edição comercial, tags, campos, observações, follow-up manual e voltar | Criar, editar e deduplicar contato real |
| 4.7 Equipe e convites | Implementado, depende do Supabase e Resend | convite, papéis, revogação e auditoria | Enviar e aceitar convite real |
| 4.8 Desempenho | Implementado, depende do Supabase | métricas separadas de registrada, enviada, entregue, lida e falha | Conferir ACKs reais do WAHA |
| 4.9 Templates | Implementado localmente | criar pela Inbox, variáveis copiáveis, preview, enquete e fallback textual | Enviar template e enquete reais |
| 4.10 LGPD | Base original mantida; campanhas reforçadas | consentimento, bloqueio/opt-out, auditoria e supressão | Revisão jurídica e teste operacional do cliente |
| 4.11 Agentes de IA | Implementado, depende do Supabase e provedor | configuração guiada, ferramentas, permissões por campo e modo por contato | Publicar agente e provar leitura/escrita permitida e negada |
| 4.12 Follow-ups | Implementado, depende do Supabase e workers | modo simples, modelos, avançado, fila, início manual e cancelamento por resposta | Executar fluxo real completo |
| 4.13 Memória da IA | Implementado, depende do Supabase | criar, editar, arquivar, reativar, histórico e exclusão | Provar que agente usa a memória publicada |
| 4.14 Webhooks e integrações | Implementado, depende do Supabase | fontes assinadas, escopo por organização, idempotência e contrato 3C | Enviar lead 3C assinado duas vezes e obter uma entrada |
| 4.15 Configurações | Implementado localmente | organização por grupos, implantação e saúde; Billing continua oculto | Conferir permissões de administrador e gerente |
| 4.16 Notificações | Implementado, depende do Supabase e Resend | preferências, central in-app, sino, leitura, e-mail, worker e teste | Emitir evento real e confirmar clique/e-mail |
| 4.17 Campanhas | Implementado, depende do Supabase, WAHA e Google | CSV ou Google Sheets autorizado, preview, consentimento, deduplicação, 5 min sequenciais, texto/áudio, pausa e retomada idempotente | Testar lista controlada e planilha compartilhada |
| 4.18 Entrada 3C | Implementado como origem segura de webhook | HMAC, organização, idempotência, auditoria e criação por contrato | Configurar segredo e homologar com a 3C |
| 4.19 Meta CAPI | Implementado, depende do Supabase e Meta | fila, hash, consentimento, deduplicação, retries, teste e configuração | Validar primeiro com código de evento de teste |
| 4.20 Billing | Oculto / fora desta fase | página administrativa de placeholder não oferecida ao cliente | Definir produto comercial antes de implementar cobrança |

## Direção visual

A página isolada `/design` existe com **Claro / Escuro / Sistema** e a proposta Graphite + Electric Blue. A troca global continua deliberadamente pendente até aprovação visual explícita. Isso não é falha de implementação: é a barreira aprovada para evitar alterar todas as telas sem validação.

## Melhorias segundo minha opiniao

Somente as sugestões autorizadas no plano (1, 2, 5, 6, 7, 10, 11, 12, 13 e 14) foram tratadas como escopo. As sugestões 3, 4, 8 e 9 continuam fora desta entrega até nova decisão.

## Portões que ainda impedem declarar produção pronta

1. autenticar a CLI e aplicar todas as migrations listadas em `ENTREGA_ROADMAP_ATRIOZ.md`;
2. integrar a branch aprovada e reimplantar pelo EasyPanel;
3. configurar segredos somente no servidor, inclusive Google Sheets, 3C, Meta e Resend;
4. executar a matriz de homologação com WhatsApp e provedores reais;
5. criar backup completo e ensaiar restauração;
6. aprovar `/design` antes de qualquer mudança global de cores.

## Evidência da validação local mais recente

- testes específicos do Google Sheets: 3 aprovados;
- TypeScript: aprovado;
- ESLint dos arquivos alterados: aprovado;
- build Next.js 16.2.11: aprovado, 43 páginas geradas;
- commit publicado no fork: `a79aae8`.

Essas provas validam o pacote local. Elas não substituem migrations, credenciais nem testes ao vivo.
