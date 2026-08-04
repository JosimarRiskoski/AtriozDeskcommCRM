# Plano para aprovacao futura — reuniao de duvidas e melhorias

Data de consolidacao: 03/08/2026  
Projeto: AtriozDeskcommCRM  
Estado deste documento: **rascunho para aprovacao; nenhuma implementacao autorizada por este documento**

## 1. Objetivo e regra de execucao

Este plano consolida a transcricao da reuniao e as anotacoes posteriores. Ele separa:

- **Existente:** localizado no codigo atual; ainda pode exigir validacao no ambiente publicado.
- **Parcial:** existe a fundacao, mas falta interface, regra ou validacao ponta a ponta.
- **Novo:** exige implementacao.
- **Validar:** nao deve ser alterado antes de reproduzir e confirmar o comportamento real.
- **Nao fazer:** decisao explicita de preservar o comportamento atual.

As fases abaixo so devem ser executadas depois de aprovacao explicita. Cada fase deve terminar com testes automatizados proporcionais ao risco, validacao visual e homologacao no ambiente real antes da publicacao global.

## 2. Decisoes consolidadas

1. **Contato e a fonte central da pessoa.** Inbox referencia conversas; Kanban referencia oportunidades. Nao duplicar os mesmos dados em tres cadastros.
2. **Inbox lista conversas reais.** Contatos sem conversa aparecem na busca e podem iniciar uma conversa, mas nao criam conversa vazia.
3. **Criar oportunidade e opcional e configuravel por origem.** Cadastro, campanha, webhook e 3C exibem `Criar oportunidade no Kanban`.
4. **Origem e estruturada e historica.** Tags continuam como segmentacao complementar, nao como unica fonte de relatorio.
5. **Cadencia e vinculada ao contato.** Pode ser iniciada pelo Contato, Inbox ou Kanban; todos operam a mesma inscricao.
6. **IA e cadencia sao controles separados.** Ativar IA nunca inicia uma cadencia implicitamente.
7. **Excluido e bloqueio total ate reativacao manual no contato.** Nao e etapa do funil e veta envio manual, IA, campanha, follow-up, automacao e integracao.
8. **Perdido continua elegivel para reativacao**, salvo opt-out, exclusao, telefone invalido ou outra cadencia viva.
9. **Distribuir campanha** significa dividir equilibradamente os contatos entre as conexoes selecionadas e manter o vinculo contato-conexao; nao trocar de numero a cada mensagem.
10. **Fechamento previsto permanece como esta.** Nenhuma alteracao nesta etapa.
11. **Campos comerciais devem ser personalizaveis por pipeline/nicho.** `Valor previsto da fatura` e um rotulo configuravel, nao um nome global fixo.
12. **Documentos que exigem humano sao configuraveis por organizacao/nicho.** Para a operacao atual: documento pessoal e fatura de energia.
13. **Ao atingir 100% do orcamento da IA, pausar a IA e avisar em todos os canais configurados.** Atendimento humano permanece disponivel.
14. **Alertas para grupo de gestores sao um destino separado.** Nao transformar o grupo em contato, conversa comercial ou oportunidade.
15. **Todo texto apresentado ao usuario deve estar em pt-BR.** Codigo tecnico pode manter identificadores internos em ingles.

## 3. Fase 0 — diagnosticos obrigatorios antes das mudancas

### 3.1 Contatos bloqueados

**Estado:** existe, mas a explicacao visual e insuficiente.

Investigar os dois contatos atualmente marcados como `Bloqueado` e registrar, sem alterar dados:

- valor de `is_blocked`, `blocked_reason` e `blocked_at`;
- evento de auditoria que originou o bloqueio;
- se veio de palavra de parada/opt-out, usuario, importacao, IA ou integracao;
- campanhas, cadencias e mensagens vetadas por esse estado.

So depois do diagnostico decidir se algum dos dois foi bloqueado indevidamente.

### 3.2 Duplicidade de telefone com nono digito

**Estado:** defeito relatado; validar antes de corrigir.

Reproduzir o caso em que `+55 DDD 8...` e `+55 DDD 9 8...` viram dois contatos. Levantar origem, valor bruto, valor normalizado, identidade WAHA (`@c.us`, `@s.whatsapp.net` ou `@lid`) e contato criado. Definir uma normalizacao brasileira unica e uma ferramenta segura de mesclagem; nunca mesclar automaticamente quando houver ambiguidade real.

### 3.3 Contatos recebidos sem nome ou telefone

**Estado:** o inbound ja faz upsert, mas existem casos incompletos.

Nao descartar silenciosamente mensagens recebidas. O fluxo deve:

1. tentar resolver telefone pelo `chatId` canonico;
2. quando vier `@lid`, consultar a resolucao da propria instancia WAHA;
3. capturar nome de exibicao quando o provedor o fornecer;
4. se houver telefone e nao houver nome, usar temporariamente `Contato + ultimos 4 digitos` e marcar `cadastro incompleto`;
5. se nao houver telefone resolvido, criar uma pendencia tecnica vinculada a mensagem, sem criar um contato comercial defeituoso;
6. permitir reconciliacao posterior sem perder a mensagem.

A instancia identifica o numero de WhatsApp conectado e pode ajudar a resolver `@lid`, mas nao inventa o nome que o WhatsApp nao forneceu.

### 3.4 Campo personalizado perde foco

**Estado:** defeito a reproduzir.

Confirmar a tela e o componente em que cada caractere causa perda de foco. Corrigir somente depois de identificar se a causa e remontagem do componente, chave instavel ou persistencia a cada tecla.

### 3.5 Item desconhecido da reuniao

Manter no backlog, sem implementar: `Simplificar a area de implantacao do cliente`. Localizar a tela e confirmar a intencao em uma futura homologacao.

## 4. Fase 1 — Inbox, atendimento humano e conexoes

### 4.1 Acao `Pegar conversa`

**Estado:** parcial. O codigo atual possui `Assumir`, exibido apenas em conversa aberta ou sem responsavel.

Alterar a experiencia para:

- botao primario `Pegar conversa` na conversa disponivel;
- mostrar `Atendida por <nome>` quando ja tiver responsavel;
- exibir `Transferir` e `Liberar` conforme permissao;
- manter o atalho de teclado e atualizar sua legenda;
- explicar por que o botao nao aparece quando a conversa ja esta com outro atendente;
- registrar pegar, liberar e transferir no historico;
- manter controle atomico para impedir duas pessoas de pegarem a mesma conversa.

### 4.2 Painel direito do Inbox

**Estado:** parcial. Ja mostra dados do contato, oportunidades, pedidos, atividades e tags.

Ampliar, sem poluir, com secoes recolhiveis:

- dados do contato e estado de cadastro;
- numero/conexao que recebeu a conversa;
- origem principal e historico de origens;
- oportunidade, etapa, valor e responsavel;
- observacoes internas;
- memoria permitida para IA;
- cadencia ativa e proxima acao;
- agente ativo e motivo da selecao;
- bloqueios e consentimento;
- caso humano aberto, resumo e urgencia;
- botao `Abrir contato completo`.

### 4.3 Controle claro de IA na conversa

**Estado:** parcial. Existem `Seguir configuracao geral`, `Ativar IA somente neste contato` e `Pausar IA neste contato`.

Substituir ambiguidade por um bloco visivel:

- estado: `IA ativa`, `IA pausada`, `Humano atendendo` ou `Seguindo regra geral`;
- agente ativo e regra que o escolheu;
- botoes `Ativar IA`, `Pausar IA` e `Trocar agente`;
- aviso de que ativar IA nao ativa cadencia;
- quando humano pegar a conversa, pausar IA automaticamente;
- acao explicita `Devolver para IA`;
- escolha manual prevalece sobre regra de conexao/etapa ate ser liberada.

### 4.4 Criar handoff manual no Inbox

**Estado:** novo sobre fundacao existente de casos humanos.

Adicionar `Criar caso humano` no Inbox. Abrir formulario com:

- titulo;
- motivo;
- urgencia;
- resumo editavel sugerido pela IA;
- responsavel ou fila;
- opcao de incluir a conversa completa por link;
- opcao de publicar o aviso no grupo de gestores.

Ao criar, exibir o caso no painel direito e na central `Casos humanos`.

### 4.5 Identidade das conexoes

**Estado:** parcial. A tela ja mostra nome/numero quando disponiveis e saude.

Padronizar em todo o CRM:

- nome amigavel obrigatorio;
- numero completo e ultimos quatro digitos;
- finalidade configuravel;
- status e motivo;
- conexao padrao para novos envios;
- selo no Inbox e filtros por conexao;
- resposta pela mesma conexao por padrao.

### 4.6 Excluir numero/conexao vinculada

**Estado:** novo na interface; o cliente WAHA ja suporta excluir sessao tecnica.

Adicionar acao administrativa `Excluir conexao`, com:

1. bloquear exclusao se estiver ativa, salvo desconectar primeiro;
2. mostrar dependencias: conversas, campanhas, agentes, cadencias e regras;
3. exigir escolha de substituta para dependencias ativas;
4. preservar historico e mensagens;
5. excluir/desativar o registro do CRM e a sessao WAHA de maneira coordenada;
6. registrar usuario, data e motivo;
7. exigir confirmacao digitando o nome da conexao.

Preferir `Arquivar conexao` quando houver historico; exclusao tecnica fica reservada a sessao quebrada ou criada por engano.

## 5. Fase 2 — contatos, origem, oportunidade e Kanban

### 5.1 Cadastro rapido

**Estado:** novo sobre dialogo de contato existente.

Disponibilizar em dois lugares:

- **Contatos:** botao `Novo contato` abre cadastro rapido.
- **Inbox:** botao `Novo contato/conversa` abre o mesmo cadastro e continua para o envio.

Campos iniciais: nome, telefone, origem e consentimento/base de contato. Opcoes:

- `Criar oportunidade no Kanban`;
- `Salvar e iniciar conversa`;
- `Iniciar cadencia depois de salvar` — desmarcada por padrao.

Depois de salvar, mostrar `Completar cadastro` para empresa, e-mail, valor, observacao, proxima acao e campos personalizados.

### 5.2 Inicio de conversa por contato

**Estado:** novo/parcial.

Permitir buscar contato no Inbox e iniciar conversa escolhendo conexao. Validar telefone no WhatsApp, elegibilidade e bloqueios. Criar a conversa somente no primeiro envio bem-sucedido.

### 5.3 Modelo central e deduplicacao

**Estado:** parcial.

Aplicar o mesmo servico de normalizacao/upsert a WhatsApp, cadastro manual, CSV, campanha, formulario, webhook, 3C e trafego pago. Chaves em ordem:

1. organizacao + origem + identificador externo;
2. identidade canonica do WhatsApp;
3. telefone E.164 normalizado;
4. e-mail/documento quando permitido;
5. ambiguidade gera revisao, nao novo contato silencioso.

### 5.4 Origem principal e historico

**Estado:** parcial.

Criar/usar eventos de origem imutaveis com data, tipo, campanha, integracao, conexao, identificador externo e dados de rastreamento. Exibir:

- selo da origem principal no contato, Inbox e cartao do Kanban;
- linha `Primeira origem` e `Ultima interacao de origem`;
- secao `Historico de origens` na linha do tempo;
- filtro e relatorios por origem;
- tags adicionais separadas.

### 5.5 Criar oportunidade de forma configuravel

**Estado:** novo/parcial.

Adicionar `Criar oportunidade` em cadastro rapido, campanha, fonte de webhook e contrato 3C. Em cada origem, permitir uma regra padrao ligada/desligada, sempre com possibilidade de ajuste antes da execucao coletiva.

### 5.6 Pipeline padrao e navegacao por abas

**Estado:** novo sobre pipelines configuraveis existentes.

- Kanban abre diretamente o pipeline marcado como principal;
- demais pipelines aparecem como abas/seletor no topo;
- ao criar/editar pipeline, checkbox `Definir como pipeline principal`;
- somente um principal por organizacao, garantido no banco;
- ao marcar outro, mostrar confirmacao e desmarcar o anterior atomicamente;
- permitir editar o nome da etapa ao clicar no cabecalho, conforme permissao;
- permitir reordenar, adicionar, arquivar e configurar etapa sem sair do Kanban;
- manter a pagina avancada de Configuracoes para administracao completa.

Criar como opcao de pipeline o modelo:

1. Interesse;
2. Aguardando documentacao;
3. Aguardando proposta;
4. Aguardando fechamento;
5. Fechado/Ganho;
6. Perdido.

Preservar o pipeline atual; o usuario escolhe qual sera principal.

### 5.7 Cartao simples e indicadores

**Estado:** parcial.

Cartao: nome, origem, valor configurado, responsavel, proxima acao e alertas. Detalhes ficam no dossie. Medir mudanca de etapa, tempo por etapa, ganho, perda, valor previsto e responsavel para indicadores gerenciais.

### 5.8 Campos e observacoes por nicho

**Estado:** parcial.

- rotulo de valor configuravel por pipeline, por exemplo `Valor previsto da fatura`;
- observacao interna visivel apenas a humanos;
- nota autorizada para memoria da IA;
- dado comercial estruturado;
- indicacao visual de privacidade de cada campo.

Nao alterar `fechamento previsto` nesta rodada.

## 6. Fase 3 — bloqueio, LGPD e elegibilidade central

### 6.1 Estado de exclusao/bloqueio

**Estado:** parcial; `contacts.is_blocked` ja veta varios caminhos.

Centralizar no contato, em secao visivel `Comunicacao e privacidade`:

- status `Ativo` ou `Excluido — bloqueio total`;
- motivo, data, origem e ator;
- botao administrativo `Excluir/bloquear contato`;
- botao `Reativar contato`, com confirmacao e motivo;
- historico imutavel;
- aviso no Inbox, Kanban e campanhas.

O gate central deve ser chamado por envio manual, IA, campanha, follow-up, automacao, webhook e integracao. Nenhum desses caminhos pode contornar o bloqueio.

### 6.2 Opt-out e reativacao

Pedido de parada marca bloqueio total, cancela cadencias e remove campanhas pendentes. Reativacao e somente manual no contato e deve registrar justificativa; pedido de opt-out nao pode ser revertido silenciosamente por nova importacao.

### 6.3 Elegibilidade numerica e em pt-BR

Na previa de campanha, exibir numeros absolutos, por exemplo:

- `50 contatos importados`;
- `38 elegiveis`;
- `4 duplicados`;
- `3 sem consentimento`;
- `2 excluidos`;
- `2 telefones invalidos`;
- `1 nao foi possivel verificar`.

Validacao de WhatsApp deve responder em pt-BR: `Confirmado`, `Nao encontrado` ou `Nao foi possivel verificar`.

## 7. Fase 4 — follow-ups, reativacao e agentes

### 7.1 Onde iniciar e visualizar cadencia

**Estado:** parcial. A inscricao ja pertence ao contato.

Disponibilizar a mesma acao `Iniciar follow-up` em:

- Contato: acao principal e historico completo;
- Inbox: acao rapida no painel direito;
- Kanban: acao no cartao e acao coletiva por selecao.

O seletor deve mostrar objetivo, duracao, etapas, agente, proximo envio, conexao e regra `Cancelar se responder`. Depois de ativar, exibir selo e proxima acao nos tres lugares.

### 7.2 Editor simples de follow-up

**Estado:** parcial.

Melhoria visual definida:

- modo simples como padrao, baseado em modelos;
- lista cronologica `Mensagem → espera → condicao → mensagem`;
- previa de texto e datas;
- validacoes em linguagem comum;
- botoes claros `Salvar rascunho`, `Publicar` e `Ativar para contato`;
- modo avancado em `Personalizar fluxo`;
- fila com contato, fluxo, agente, proxima acao e botao cancelar.

### 7.3 Aplicacao coletiva

Filtros por perdido, etapa, tag e grupo. Antes de confirmar, mostrar total selecionado, elegiveis e excluidos por motivo. Nao incluir bloqueados, opt-out, telefone invalido ou contato com follow-up vivo.

### 7.4 Reativacao de perdidos

Exibir uma area compreensivel `Reativacoes` no Kanban/Follow-ups:

- perdidos ha 30 dias;
- motivo da elegibilidade;
- ultima interacao;
- fluxo sugerido;
- iniciar individual ou coletivamente;
- indicar quando a estrutura automatica existente gerou uma proposta/alerta.

### 7.5 Resposta interrompe cadencia

Manter a logica existente e validar com WhatsApp real: mensagem recebida cancela todos os proximos passos, inclusive item concorrente da fila. Registrar o motivo `Cliente respondeu`.

### 7.6 Agente por conversa, numero e etapa

**Estado:** parcial.

- regra padrao por conexao, origem e etapa;
- seletor manual no Inbox;
- escolha manual prevalece;
- troca por etapa e configuravel, nunca obrigatoria;
- ao mover etapa, mostrar qual agente sera mantido/trocado;
- humano atendendo impede troca automatica;
- historico de agente e motivo.

### 7.7 Limites e respostas controladas

Configurar por agente:

- base de conhecimento permitida;
- ferramentas permitidas;
- assuntos proibidos;
- respostas fixas para politicas, precos e avisos legais;
- assuntos que exigem humano;
- proibicao de internet externa, quando aplicavel;
- resposta `Nao encontrei essa informacao` em vez de inventar;
- limite mensal, diario e por execucao.

Ao atingir 100%, pausar novos turnos de IA, manter humano e notificar central do CRM, responsaveis, e-mail e grupo de gestores conforme preferencias do admin.

### 7.8 Memoria e base de conhecimento compreensiveis

**Estado:** fundacao existente; falta visibilidade e validacao.

Criar painel `O que a IA sabe nesta conversa` com resumo anterior, notas autorizadas, fontes ativas, agente e ultima atualizacao. Criar pagina de teste que mostre fonte usada, informacao nao encontrada e motivo de handoff. Validar uma conversa real longa; so depois marcar como homologado.

## 8. Fase 5 — casos humanos, responsaveis e grupo de gestores

### 8.1 Central de casos humanos

**Estado:** backend e paginas existem; tornar acesso evidente.

- item destacado no menu `Casos humanos` com contador aberto;
- abas `Aguardando humano`, `Aguardando cliente`, `Escalados` e `Resolvidos`;
- filtros por responsavel, urgencia, agente e tempo aberto;
- link direto para conversa e contato;
- caso aberto visivel no Inbox;
- resumo estruturado, bloqueio, atividades, documentos e motivo;
- atribuicao, transferencia, resposta, escalada e resolucao auditadas.

### 8.2 Responsaveis por casos

Na criacao/edicao de membro, checkbox `Pode receber casos humanos`. Permitir varios membros e definir um responsavel principal/fila padrao. Se nenhum existir, o onboarding administrativo deve exigir a configuracao antes de ativar casos automaticos.

### 8.3 Regras configuraveis de handoff

Nao guardar regras de nicho apenas em texto livre da base de conhecimento. Criar configuracao estruturada por agente/organizacao:

- pedido explicito de humano;
- baixa confianca ou informacao ausente;
- falhas repetidas;
- reclamacao/risco;
- calculo ou excecao comercial;
- tipos de documento;
- palavras/intenções configuraveis;
- ferramenta indisponivel.

Para a organizacao atual, iniciar com `documento pessoal` e `fatura de energia`. Outros nichos escolhem seus proprios tipos.

### 8.4 Prazos e notificacoes

Em Configuracoes > Atendimento humano, o admin escolhe:

- prazo para primeiro aviso;
- prazo para escalada;
- horario de atendimento;
- responsaveis/fila;
- canais: CRM, e-mail e grupo WhatsApp;
- categorias enviadas a cada canal;
- repeticao e encerramento do alerta.

### 8.5 Grupo WhatsApp de gestores

**Estado:** novo. O envio WAHA suporta chat de grupo, mas grupos hoje sao ignorados no inbound comercial.

Criar em Configuracoes > Notificacoes > Grupo de gestores:

- conexao usada;
- seletor de grupo descoberto pela instancia ou campo de `group_chat_id` validado;
- nome de exibicao do grupo;
- switches `Handoffs`, `Erros do CRM`, `Conexao caiu`, `Orcamento da IA`, `Campanha pausada`;
- switch separado `Permitir responder no grupo`;
- teste de envio;
- modelo de mensagem editavel.

Mensagem padrao de handoff:

```text
NOVO CASO HUMANO
Contato: <nome>
Telefone: <telefone mascarado ou completo conforme permissao>
Resumo: <breve problema>
Urgencia: <nivel>
Responsavel: <pessoa/fila>
Abrir no CRM: <link seguro>
```

Se `Permitir responder no grupo` estiver desligado, mensagens do grupo nunca acionam a IA. Se estiver ligado, aceitar apenas gestores autorizados e comandos delimitados, relacionar cada resposta a um `case_id`, registrar auditoria e nunca misturar o grupo ao Inbox comercial. Uma resposta livre sem identificador deve ser recusada com instrucao clara.

### 8.6 Botao para continuar por outra conexao

Quando uma conexao estiver indisponivel — e somente se o contato nao estiver bloqueado — oferecer `Continuar por outra conexao`. Ao clicar:

- selecionar conexao saudavel;
- mostrar resumo da conversa no painel direito;
- gerar sugestao de mensagem de contexto;
- exigir confirmacao humana;
- manter vinculo e auditoria entre conversa anterior e nova;
- nunca usar para contornar opt-out/bloqueio do contato.

## 9. Fase 6 — campanhas

### 9.1 Validar e visualizar

Logo apos `Validar e visualizar`, mostrar contagens numericas de elegibilidade e calcular:

- inicio previsto;
- termino previsto;
- duracao total;
- contatos por conexao;
- intervalo e janela de envio.

Recalcular durante a execucao com progresso e nova previsao.

### 9.2 Criar oportunidade

Checkbox `Criar oportunidade no Kanban` na criacao da campanha, com pipeline e etapa. Antes de executar, deduplicar contato e oportunidade. Corrigir primeiro o caso do nono digito descrito na Fase 0.

### 9.3 Dividir entre numeros selecionados

Opcao `Dividir contatos entre os numeros selecionados`. Fluxo:

1. usuario seleciona duas ou mais conexoes autorizadas;
2. sistema remove conexoes sem saude/capacidade;
3. distribui os elegiveis de modo equilibrado, com leve embaralhamento apenas da ordem da lista;
4. grava `recipient -> channel_session_id` antes do primeiro envio;
5. mantem todas as mensagens daquele contato na conexao atribuida;
6. mostra a divisao na previa;
7. pausa novas atribuicoes se uma conexao falhar;
8. reatribuicao exige confirmacao e auditoria.

### 9.4 Origem e respostas

Registrar `origem = campanha`, nome/ID da campanha, conexao e evento na linha do tempo. Respostas entram no Inbox e permanecem relacionadas ao contato, conexao e campanha.

## 10. Fase 7 — webhooks, 3C e trafego pago

### 10.1 Contrato de entrada padrao

Toda fonte possui mapeamento, assinatura, idempotencia, normalizacao, historico e checkbox `Criar oportunidade`. A origem nunca e sobrescrita sem registrar evento.

### 10.2 3C

**Estado:** a plataforma ja permite criar e rotacionar tokens de API em geral; falta contrato especifico e experiencia guiada da 3C.

- token proprio, escopo minimo e organizacao fixa;
- tela para gerar novo token, periodo de sobreposicao, teste e revogacao;
- nunca entregar `service_role` ou acesso direto ao Supabase;
- mapear identificador externo, origem e estado de automacao;
- impedir cadencia duplicada;
- criar contato e, quando marcado, oportunidade.

Dependencia futura: exemplo anonimizado do payload e politica de renovacao suportada pela 3C.

### 10.3 Trafego pago

Criar modelo pronto de automacao:

1. fonte `Trafego pago` recebe o lead;
2. normaliza/deduplica;
3. opcionalmente cria oportunidade em pipeline/etapa escolhidos;
4. atribui agente especifico;
5. opcionalmente ativa IA;
6. opcionalmente inicia cadencia publicada `Lead de trafego pago`;
7. cancela cadencia ao responder;
8. registra campanha/anuncio quando recebido no payload;
9. encaminha para humano pelas regras configuradas.

Comecar desligado e exigir piloto/homologacao antes de ativacao automatica geral.

## 11. Fase 8 — desempenho, falhas e auditoria

### 11.1 Indicador Falharam

Transformar o indicador em filtro clicavel. Drawer/pagina de detalhes com:

- data e hora;
- contato;
- conexao;
- operacao;
- modulo;
- categoria traduzida;
- motivo compreensivel;
- detalhe tecnico recolhivel;
- tentativas;
- estado final;
- acao recomendada.

Categorias: conexao, telefone, consentimento/bloqueio, mensagem, midia/documento, IA, integracao, timeout e erro interno.

### 11.2 Historico de seguranca

Mostrar ator como usuario, Sistema, IA, Webhook ou Integracao, com nome quando houver. Manter IDs tecnicos nos detalhes.

### 11.3 Comparacao humano x IA

Painel por periodo e origem: primeira resposta, resolucao, conversao, handoff, custo, reabertura e qualidade. Nao usar apenas volume de mensagens.

## 12. Criterios de aceite transversais

- textos visiveis em pt-BR e sem mojibake;
- isolamento entre organizacoes;
- permissoes por papel;
- auditoria para acoes sensiveis;
- nenhuma duplicacao de contato, conversa, oportunidade, cadencia ou envio;
- bloqueio central testado em todos os caminhos;
- comportamento responsivo e acessivel;
- preservar origem, filtros, aba, pagina e pesquisa ao voltar;
- testes unitarios/integracao e jornada autenticada real;
- build local e validacao no ambiente publicado;
- rollback/migracao segura para mudancas de banco.

## 13. Ordem sugerida para aprovacao e execucao

1. Fase 0: diagnosticos e defeitos de integridade.
2. Fase 1: Inbox, Pegar conversa, painel e conexoes.
3. Fase 2: contato central, origem, deduplicacao e Kanban.
4. Fase 3: bloqueio/LGPD e elegibilidade.
5. Fase 4: follow-ups, agentes, memoria e limites.
6. Fase 5: casos humanos e grupo de gestores.
7. Fase 6: campanhas e distribuicao entre numeros.
8. Fase 7: 3C e trafego pago.
9. Fase 8: desempenho, falhas e comparativos.

## 14. Matriz das anotacoes recebidas

Esta matriz garante que nenhuma anotacao foi interpretada como implementacao ja concluida.

| Anotacao | Tratamento no plano |
|---:|---|
| 1 | Indicador `Falharam` clicavel na Fase 8.1. |
| 2 | Identidade dos numeros/conexoes na Fase 4.5. |
| 3 | Criacao de oportunidade configuravel, Fases 5.5 e 10.2. |
| 4 | Contatos sem conversa localizaveis no Inbox, Fases 5.1 e 5.2. |
| 5 | Upsert padrao para todas as origens, Fase 5.3. |
| 6 | Vinculo e filtro por conexao no Inbox, Fases 4.2 e 4.5. |
| 7 | Numero/conexao e origem exibidos separadamente, Fases 4.2 e 5.4. |
| 8 | Regra automatica mais escolha manual de agente, Fase 7.6. |
| 9 | `Salvar e iniciar conversa`, Fase 5.1. |
| 10 | Contato sempre; oportunidade e conversa apenas quando escolhidas, Fase 5.1. |
| 11 | Cadastro, primeiro envio e cadencia como escolhas separadas, Fase 5.1. |
| 12 | Cadastro rapido em Contatos e Inbox, Fase 5.1. |
| 13 | Pausar IA no teto e avisar nos canais configurados, Fases 7.7 e 8.4. |
| 14 | Restricao por fontes, ferramentas, assuntos e guardrails, Fase 7.7. |
| 15 | Estado e botoes de IA claros no Inbox, Fase 4.3. |
| 16 | Agente automatico e manual, Fase 7.6. |
| 17 | Agente, numero e motivo visiveis sem confusao, Fases 4.2 e 7.6. |
| 18 | Fundacao de memoria existente; validar conversa longa, Fase 7.8. Nao considerar homologado antes do teste. |
| 19 | Tornar base e guardrails compreensiveis, Fases 7.7 e 7.8. |
| 20 | Cadencia acessivel por Contato, Inbox e Kanban, Fase 7.1. |
| 21 | Selo, fluxo e proxima acao visiveis, Fase 7.1. |
| 22 | Contato confirmado como vinculo central, decisao 5. |
| 23 | Seletor de fluxo simplificado, Fase 7.2. |
| 24 | Follow-up coletivo de perdidos, Fase 7.3. |
| 25 | Cadencia por tag/etapa com previa, Fase 7.3. |
| 26 | Reativacoes existentes expostas claramente, Fase 7.4. |
| 27 | Teste real de resposta/cancelamento mantido como aceite, Fase 7.5. |
| 28 | Documentos configuraveis por nicho; atuais: pessoal e fatura, Fase 8.3. |
| 29 | Troca por etapa como regra configuravel e explicada antes de aplicar, Fase 7.6. |
| 30 | Fonte unica do estado comercial: contato/oportunidade compartilhados; validar sincronismo na Fase 5.3. |
| 31 | Ativo, Perdido, Excluido e Opt-out explicados em `Comunicacao e privacidade`, Fase 6.1. |
| 32 | Gatilhos estruturados e publicacao opcional no grupo, Fases 8.3 e 8.5. |
| 33 | Botao manual de caso e painel enriquecido no Inbox, Fases 4.2 e 4.4. |
| 34 | Estrutura de casos existente sera tornada operacional e visivel, Fase 8.1. |
| 35 | Checkbox de membro apto a casos e obrigacao no onboarding, Fase 8.2. |
| 36 | Prazo de e-mail/escalada escolhido pelo admin, Fase 8.4. |
| 37 | Estimativa logo apos `Validar e visualizar`, Fase 9.1. |
| 38 | Atribuicao contato-conexao persistida por destinatario, Fase 9.3. |
| 39 | Opcao `Dividir contatos entre os numeros selecionados`, Fase 9.3. |
| 40 | Botao humano para continuar por outra conexao e resumo lateral, Fase 8.6. |
| 41 | Validacao do bloqueio em todos os envios, Fases 3.1 e 6.1. |
| 42 | Campo/regra `Criar oportunidade` confirmado, Fases 5.5 e 10.1. |
| 43 | Rotacao de token e possivel como fundacao; fluxo 3C ainda sera construido, Fase 10.2. |
| 44 | Origem identificada por selo, primeira/ultima origem e linha do tempo, Fase 5.4. |
| 45 | Botao voltar/configuracoes entra nos criterios transversais de navegacao. |
| 46 | Usuario/ator no historico de seguranca, Fase 11.2. |
| 47 | Identificacao de conexoes incorporada na Fase 4.5. |
| 48 | Defeito de digitacao, Fase 3.4. |
| 49 | Area de implantacao mantida como anotacao para localizar depois, Fase 3.5. |
| 50 | Erros por categoria, filtros e detalhe recolhivel, Fase 11.1. |
| 51 | Nao criar contato comercial sem identidade; preservar mensagem em pendencia, Fase 3.3. |
| 52 | Checkbox por origem para criar oportunidade, Fase 5.5. |
| 53 | Padronizacao de criacao em todas as origens, Fase 5.3. |
| 54 | Instancia ajuda com numero/`@lid`; nome depende do dado fornecido, Fase 3.3. |
| 55 | Criar contato rapido no Inbox, Fase 5.1. |
| 56 | Iniciar conversa escolhendo conexao e validando elegibilidade, Fase 5.2. |
| 57 | Contato como registro central, Fase 5.3. |
| 58 | Contatos permanece base geral, decisao 1. |
| 59 | Origem e historico em Contato, Inbox e Kanban, Fase 5.4. |
| 60 | Origem estruturada e tags complementares, Fase 5.4. |
| 61 | Contato manual localizavel sem conversa vazia, Fase 5.2. |
| 62 | Selo de origem e tags separadas no cartao, Fases 5.4 e 5.7. |
| 63 | Indicadores gerenciais alimentados pelo Kanban, Fase 5.7. |
| 64 | Cartao simples com detalhes no dossie, Fase 5.7. |
| 65 | Pipeline principal abre direto; demais como abas; modelo novo opcional, Fase 5.6. |
| 66 | `Excluido` retirado das etapas e convertido em bloqueio central, Fase 6.1. |
| 67 | Perdidos continuam disponiveis para reativacao, Fase 7.4. |
| 68 | Bloqueio configurado no contato em `Comunicacao e privacidade`, Fase 6.1. |
| 69 | `Fechamento previsto` nao sera alterado, decisoes 10 e Fase 5.8. |
| 70 | Rotulo do valor facilmente configuravel por pipeline/nicho, Fase 5.8. |
| 71 | Edicao inline de etapas e escolha do unico pipeline principal, Fase 5.6. |
| 72 | Observacao humana, memoria da IA e campos estruturados separados, Fase 5.8. |
| 73 | Seletor e estado do agente claros no Inbox, Fases 4.3 e 7.6. |
| 74 | Follow-up central com acessos em Contato, Inbox e Kanban, Fase 7.1. |
| 75 | Melhoria visual do follow-up detalhada na Fase 7.2. |
| 76 | Follow-up coletivo com previa, Fase 7.3. |
| 77 | Cadencia por etapa/tag/grupo, Fase 7.3. |
| 78 | Contato excluido impedido de receber cadencia, Fases 6.1 e 7.3. |
| 79 | Comparacao humano x IA incorporada na Fase 11.3. |
| 80 | Resumo estruturado mais link para conversa, Fases 4.4 e 8.1. |
| 81 | Casos: responsaveis, fila, prazo e canais consolidados nas Fases 8.2 a 8.5; sem pergunta pendente. |
| 82 | Campanha com `Criar oportunidade` e diagnostico do nono digito, Fases 3.2 e 9.2. |
| 83 | Origem de campanha por tipo, nome/ID e linha do tempo, Fase 9.4. |
| 84 | Verificacao de WhatsApp sempre apresentada em pt-BR, Fase 6.3. |
| 85 | Previa com numeros absolutos, Fase 6.3. |
| 86 | Opt-out bloqueia todas as origens de envio, Fase 6.2. |
| 87 | Cadencia de trafego pago detalhada passo a passo, Fase 10.3. |
| 88 | Numero/canal de entrada visivel no Inbox, Fases 4.2 e 4.5. |
| 89 | `Excluido` confirmado como bloqueio total ate reativacao manual, decisao 7 e Fase 6.1. |

## 15. Pendencias externas, nao bloqueadoras do plano

- localizar a tela chamada de `implantacao do cliente`;
- obter payload e politica de tokens da 3C antes da implementacao dessa integracao;
- homologar regras de LGPD e comunicacao com responsavel juridico;
- validar grupo real, gestores autorizados e conexao usada antes de ativar alertas;
- aprovar visualmente as mudancas em pagina isolada antes de aplicar estilos globais.

