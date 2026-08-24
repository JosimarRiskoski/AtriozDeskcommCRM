# Plano de auditoria e correções do Átrioz CRM

Data: 24/08/2026
Status: aprovado e em execução
Regra desta etapa: implementação autorizada pelo usuário, com diagnóstico antes da correção e validação antes de commit/push/deploy.

## Objetivo

Corrigir os defeitos confirmados nos prints e no código, simplificar fluxos confusos e preservar histórico comercial e de atendimento. As dúvidas funcionais foram mantidas fora deste plano e respondidas no chat.

## Critérios gerais

- Nenhuma conexão, conversa, contato, oportunidade, compromisso, credencial ou token será apagado automaticamente.
- Conexões antigas serão arquivadas e ocultadas por padrão, preservando o histórico.
- Toda operação que crie, mova, arquive, cancele ou exclua algo terá confirmação e retorno visual claro.
- Rotas filhas devem manter o módulo correto destacado no menu lateral.
- Modais devem funcionar em notebook, desktop e celular, com rodapé sempre acessível.
- Antes de alterar banco, será produzida migration idempotente e reversível quando possível.

## Diagnóstico confirmado

| Área                          | Classificação                   | Evidência encontrada                                                                                                                  | Resultado esperado                                                                                                           |
| ----------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Perfil/avatar                 | Melhoria                        | O perfil aceita somente URL pública                                                                                                   | Upload de imagem com prévia, troca e remoção                                                                                 |
| Política de Privacidade       | Novo                            | A organização armazena apenas uma URL externa, mas ainda não possui uma política pública própria gerada pelo CRM                      | Criar página pública da Política de Privacidade da Átrioz CRM, ligá-la à configuração e permitir atualização administrativa  |
| Navegação de Configurações    | Defeito                         | Saúde, Implantação e Histórico usam rotas fora de `/app/settings`; o destaque depende do prefixo da rota                              | Voltar em todas as subtelas e Configurações ativa em toda a árvore                                                           |
| Navegação de Agentes IA       | Defeito                         | O item lateral aponta apenas para `/app/ai/agents`, enquanto Credenciais, Conhecimento, Uso, Execuções, Inbox e Casos são rotas irmãs | Agentes IA ativo em todo `/app/ai/**`                                                                                        |
| Atendimento humano/grupos     | Parcial                         | O toggle exige conexão e grupo; grupos só aparecem após serem descobertos pela conexão ou informados via ID `@g.us`                   | Sincronizar grupos, explicar estado vazio e salvar somente configuração válida                                               |
| Follow-up por modelo          | Defeito de fluxo                | O modelo tenta criar um fluxo com nome já existente e retorna conflito                                                                | Detectar existente e oferecer abrir, duplicar com outro nome ou criar versão                                                 |
| Credenciais de IA             | Defeito de experiência          | A exclusão é bloqueada por FK quando versões ainda referenciam a credencial                                                           | Mostrar dependências e permitir substituir a credencial nas versões antes de excluir                                         |
| Conhecimento                  | Parcial/defeito                 | Fonte de catálogo usa texto de e-commerce; fonte parcial tem zero chunks; só FAQ possui edição                                        | Linguagem genérica, diagnóstico de indexação e edição adequada por tipo                                                      |
| Uso da IA                     | Defeito a reproduzir            | A tela depende de métricas e orçamento; o usuário relata ausência de dados                                                            | Estado vazio real, erro compreensível e métricas confirmadas pela execução                                                   |
| Busca de contatos             | Defeito                         | O contato existe; a UI envia `search`; o servidor aplica `ILIKE`, mas o resultado filtrado volta vazio                                | Busca por fragmento de nome, telefone e e-mail, sem interferência do cursor anterior                                         |
| Agenda                        | Defeito + melhoria              | Ações do compromisso ficam cortadas; busca exige selecionar um resultado real                                                         | Modal responsivo, busca com resultados visíveis, cancelar/concluir/não compareceu/remarcar                                   |
| Kanban                        | Defeito crítico                 | O movimento pode ser abandonado silenciosamente quando a posição calculada colide                                                     | Movimento otimista com rollback, rebalanceamento e mensagem de erro                                                          |
| Novo lead                     | Melhoria                        | Formulário cria negócio, mas não oferece claramente localizar ou cadastrar contato                                                    | Escolher contato existente ou cadastro rápido com nome e telefone                                                            |
| Cartões/dossiê                | Melhoria                        | Há dados estruturados disponíveis, porém pouco expostos                                                                               | Cartão configurável e dossiê com contato, origem, valor, responsável, tags, próxima ação e atividade                         |
| Inbox/conexões                | Parcial                         | Filtro por conexão existe; arquivadas já podem ser ocultadas, mas o padrão não usa necessariamente a conexão principal                | Abrir no número padrão e oferecer “Todos os números” conscientemente                                                         |
| Inbox — Todos os números      | Defeito crítico confirmado      | Reproduzido no CRM publicado. Havia consulta pesada com joins, payload excessivo e duas assinaturas/consultas iguais da lista         | Consulta mínima sem join frágil, uma assinatura, cache preservado e nova tentativa sem sumir com conversas                   |
| Sugestão de resposta por IA   | Defeito confirmado pelo usuário | Embora o código chamasse a rota de rascunho, faltava confirmação inequívoca e validação publicada de que o compositor recebeu o texto | Gerar rascunho, inserir no compositor sem enviar, focar o campo e confirmar visualmente a inserção                           |
| Supabase — uso e estabilidade | Defeito operacional crítico     | Houve estouro de Egress e tempestade de consultas/eventos; já existem contenções parciais em commits anteriores                       | Medir chamadas atuais, eliminar repetição desnecessária, limitar payload/paginação e criar observabilidade e retenção segura |
| Remoção de conexão            | Defeito de experiência          | Desconectada continua alertando e o usuário não encontra encerramento definitivo                                                      | Arquivar conexão, parar alertas e ocultar conversas por padrão sem perder histórico                                          |
| Criar oportunidade no Inbox   | Defeito                         | O wizard possui etapas, mas o fluxo relatado conclui antes da confirmação final                                                       | Nenhuma gravação antes de “Confirmar e criar”                                                                                |
| Campanhas                     | Melhoria                        | Importador CSV existe, sem acesso evidente ao modelo                                                                                  | Botão “Baixar modelo CSV” junto ao seletor de arquivo                                                                        |
| Meta CAPI                     | Parcial                         | Envio manual e único por oportunidade já existem; integração está desativada sem credenciais                                          | Voltar, validar conexão, mostrar pré-requisitos e estado de entrega                                                          |
| API Tokens                    | Melhoria                        | Tokens efêmeros `agent-run:*` revogados ocupam a lista operacional                                                                    | Separar tokens manuais dos tokens internos e recolher revogados por padrão                                                   |
| Implantação do cliente        | Validar/remover                 | Página ainda aparece como integração/configuração, embora possa não ter função operacional atual                                      | Remover do menu se não houver uso; preservar rota somente se necessária ao onboarding                                        |

## Fase 0 — Reprodução e proteção

1. Criar uma lista de reprodução para cada defeito com ID de requisição e erro técnico.
2. Registrar respostas das APIs de contatos, Agenda, Kanban, IA, conexões e oportunidades sem dados sensíveis.
3. Adicionar testes de regressão antes de modificar os fluxos críticos.
4. Não executar limpeza de dados para “resolver” comportamento de interface.
5. Medir separadamente o Inbox agregado e por conexão: duração, tamanho da resposta, número de chamadas e falhas.
6. Confirmar no Supabase o uso atual de Egress, CPU, conexões, consultas frequentes e crescimento de tabelas de log.

Aceite: cada defeito deve possuir reprodução, causa identificada e teste que falha antes da correção.

## Fase 1 — Navegação, perfil e responsividade

1. Trocar Avatar URL por upload de foto, com limite de tamanho, formatos seguros, recorte/prévia e armazenamento por organização/usuário.
2. Criar um cabeçalho padrão de subpágina com “Voltar”.
3. Aplicar o cabeçalho a Saúde do sistema, Conversões da Meta, Histórico de segurança e demais subtelas sem retorno.
4. Corrigir o menu lateral para destacar Configurações em suas rotas especiais e Agentes IA em todo o módulo.
5. Corrigir rodapés e botões cortados em Agenda e demais modais altos.
6. Criar a Política de Privacidade pública da Átrioz CRM em linguagem clara, responsiva e acessível.
7. Preencher/ligar automaticamente a URL da política à página pública e permitir edição dos dados variáveis pela organização.

Aceite: navegação por teclado e mouse funciona; nenhuma ação fica fora da área visível em 1366×768 ou no celular.

## Fase 2 — Configurações, segurança e integrações

1. Atendimento humano: botão “Buscar grupos”, estado vazio explicativo, seleção por conexão e alternativa de ID manual validado.
2. Desabilitar “Avisar grupo WhatsApp” enquanto não houver conexão e grupo válidos, explicando exatamente o que falta.
3. Pipelines: adicionar ajuda contextual para “Humano”, “Ganho”, “Perdido”, agente por etapa, destino ao arquivar e campos personalizados.
4. API Tokens: duas seções — “Integrações criadas por você” e “Tokens internos de execução”; revogados recolhidos por padrão.
5. Meta CAPI: botão Voltar, checklist de Dataset/Pixel ID, token, versão, evento, consentimento e código de teste; validar antes de habilitar.
6. Implantação do cliente: confirmar uso real. Se obsoleta, remover da navegação sem apagar dados ou código de recuperação.

Aceite: telas explicam pré-requisitos e não permitem salvar estados impossíveis.

## Fase 3 — IA, memória, conhecimento e follow-ups

1. Follow-up: ao escolher modelo com nome existente, oferecer “Abrir existente”, “Criar cópia” ou informar novo nome.
2. Credenciais: listar agentes/versões dependentes e permitir migração em lote para outra credencial validada; só então liberar exclusão.
3. Conhecimento: trocar “produtos sincronizados do e-commerce” por “itens/serviços sincronizados da operação”.
4. Exibir motivo técnico de “Parcial”, quantidade aceita/rejeitada e última falha; zero chunks nunca pode parecer sucesso.
5. Disponibilizar editar/substituir conteúdo conforme o tipo de fonte permitir.
6. Uso da IA: corrigir consulta, diferenciar “sem uso” de “falha ao carregar” e mostrar período/fuso/orçamento.
7. Manter explicações breves para Novo aprendizado e Conversas opt-in.

Aceite: reindexação termina em Pronto ou Falhou com causa; métricas batem com execuções do mesmo período; credencial em uso nunca é removida sem substituição.

## Fase 4 — Contatos e Agenda

1. Isolar a busca de contatos do cursor da listagem anterior e normalizar acentos, caixa, espaços e telefone.
2. Criar testes com “emerson” encontrando “emerson hegen”.
3. Reutilizar o mesmo componente de busca no Novo compromisso e Novo lead.
4. Exigir a seleção explícita do contato ou oferecer cadastro rápido com nome e telefone.
5. Ajustar Gerenciar compromisso para que Cancelar, Concluir, Não compareceu e Remarcar estejam sempre visíveis.
6. Não apagar compromisso passado: permitir cancelar ou concluir, preservando o histórico e o evento do Google.

Aceite: os mesmos contatos aparecem nas três buscas e todas as ações da Agenda geram confirmação e atualização visual imediata.

## Fase 5 — Kanban e oportunidades

1. Substituir a saída silenciosa de colisão por rebalanceamento de posições.
2. Aplicar movimento otimista; em erro, devolver o cartão à origem e explicar a falha.
3. Bloquear duplo arrasto durante gravação e atualizar o board sem F5.
4. Novo lead: passo 1 contato existente/cadastro rápido; passo 2 negócio; passo 3 confirmação.
5. Inbox: manter o mesmo wizard e só gravar após “Confirmar e criar”.
6. Enriquecer cartão sem poluir: nome, origem, valor, responsável, próxima ação, atraso e tags essenciais.
7. Enriquecer dossiê com telefone, histórico de origem, últimas atividades e atalhos para conversa/Agenda.

Aceite: 20 movimentos consecutivos entre etapas funcionam sem cartão inclinado ou duplicado; criação nunca ocorre antes da confirmação final.

## Fase 6 — Inbox, conexões e campanhas

1. Ao abrir o Inbox, selecionar a conexão marcada como principal/padrão; “Todos os números” continua disponível.
2. Manter badge/cor por conexão em cada conversa.
3. Criar ação “Arquivar conexão” para número desconectado, com resumo do impacto e confirmação.
4. Ao arquivar: parar alertas e e-mails, ocultar conversas por padrão e preservar mensagens no banco.
5. Permitir “Incluir conexões arquivadas” para consulta histórica e eventual restauração.
6. Corrigir o botão de sugestão por IA de ponta a ponta: gerar o rascunho, inserir no campo editável e nunca enviar automaticamente.
7. Adicionar “Baixar modelo CSV” na criação de campanhas, com cabeçalhos aceitos e exemplo sem dados reais.
8. Corrigir a consulta “Todos os números”, evitando joins/payloads excessivos e falhas por paginação/cursor.
9. Durante erro transitório, manter as conversas já carregadas e mostrar ação de tentar novamente, sem substituir a lista por vazio.
10. Diferenciar falha do banco, sessão expirada, timeout e conexão inexistente nas mensagens de erro.

Aceite: conexão arquivada não dispara alertas; histórico só aparece quando solicitado; Inbox abre no número principal escolhido.

## Fase 6.1 — Proteção do Supabase

1. Auditar as consultas mais frequentes e os pontos que invalidam/refazem a lista inteira do Inbox.
2. Restringir eventos em tempo real por organização e atualizar apenas a conversa afetada quando possível.
3. Aplicar paginação estável, seleção mínima de colunas e cache/revalidação sem tempestade de requisições.
4. Aplicar retenção segura aos logs técnicos, sem apagar mensagens, contatos, conversas ou trilhas obrigatórias.
5. Criar métricas para volume de webhooks, duplicados descartados, consultas do Inbox, erros e latência.
6. Definir alertas preventivos antes de Egress/CPU atingirem níveis críticos.

Aceite: navegação ociosa não gera consultas contínuas; “Todos os números” permanece estável; o uso diário projetado fica abaixo da cota com margem e sem perda de mensagens.

## Fase 7 — Validação e entrega

1. Testes automatizados de API e interface para todos os critérios acima.
2. Build, lint e testes do projeto.
3. Homologação autenticada no CRM publicado em notebook e celular.
4. Testes reais controlados: grupos, busca, Agenda, arrasto, oportunidade, conexão arquivada, conhecimento e métricas de IA.
5. Teste prolongado do Inbox alternando “Todos os números” e cada conexão, com chegada de mensagens em tempo real.
6. Teste da sugestão da IA comprovando que o texto aparece no campo e só é enviado após ação manual.
7. Comparar métricas do Supabase antes/depois e registrar a projeção de consumo.
8. Só após aprovação técnica: commit, push e preparação do deploy pelo EasyPanel.

## Decisões adotadas para a execução

1. Cartão do Kanban: iniciar com os sete itens sugeridos, mantendo expansão no dossiê.
2. Implantação do cliente: ocultar da navegação comum e manter somente se necessária ao onboarding administrativo.
3. Conexão arquivada: permitir restauração somente por administradores.
4. Upload de avatar: recorte quadrado simples, com prévia.
5. Política de Privacidade: criar uma página pública da Átrioz CRM e permitir dados variáveis da organização.

## Fora de escopo deste plano

- Apagar histórico de conversas ao excluir/arquivar um número.
- Alterar automaticamente etapas, campanhas ou conversões da Meta sem ação humana.
- Excluir compromissos históricos do Google Agenda e do CRM.
- Excluir ou resumir mensagens, contatos e histórico comercial para reduzir uso do banco.

## Registro da execução crítica

- [x] Reprodução autenticada do erro em “Todos os números”.
- [x] Remoção da consulta/assinatura duplicada da lista de conversas.
- [x] Redução do payload e retirada do join interno frágil na consulta agregada.
- [x] Preservação da lista em cache durante falha transitória.
- [x] Página pública inicial da Política de Privacidade criada e ligada às configurações.
- [x] Confirmação visual adicionada quando a sugestão da IA entra no campo de mensagem.
- [x] Migration de retenção em lotes criada somente para logs técnicos processados.
- [x] Worker preparado para executar a retenção no boot e diariamente.
- [x] Upload de avatar implementado com prévia, troca e remoção.
- [x] Navegação de Configurações e Agentes IA corrigida nas rotas filhas.
- [x] Follow-up com nome repetido agora oferece abrir o existente ou criar cópia.
- [x] Busca de contatos corrigida para nome e display name, com sanitização e teste.
- [x] Modal da Agenda ajustado para manter ações visíveis.
- [x] Criação de oportunidade bloqueada até a confirmação da última etapa.
- [x] Movimento do Kanban preparado para reordenação atômica no banco.
- [x] Modelo CSV disponibilizado diretamente na tela de campanhas.
- [x] Tokens internos/revogados separados da lista operacional.
- [x] Fonte de conhecimento recebeu linguagem genérica e estado parcial explicativo.
- [x] Uso da IA diferencia carregamento, ausência real de uso e falha de consulta.
- [x] Uso da IA passa a ser agregado no banco, sem baixar até 250 mil registros por consulta.
- [x] Atendimento humano ganhou busca direta de grupos pela Evolution.
- [x] Fallback degradado do Inbox reduzido para uma leitura a cada 30 segundos.
- [x] Novo lead no Kanban permite buscar contato existente ou fazer cadastro rápido com nome e telefone.
- [ ] Executar as migrations 0132, 0133, 0134 e 0135 no banco publicado.
- [ ] Validar Inbox agregado e sugestão da IA depois do deploy.
