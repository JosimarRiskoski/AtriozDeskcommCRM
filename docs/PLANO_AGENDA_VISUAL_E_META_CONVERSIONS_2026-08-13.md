# Plano para aprovacao — Agenda visual e Meta Conversions API

Data do planejamento: 13/08/2026
Execucao prevista: 14/08/2026
Regra deste documento: hoje e somente planejamento. Nenhuma mudanca funcional desta demanda deve ser implantada antes da execucao aprovada.

## 1. Objetivos aprovados para o plano

1. Transformar a pagina **Agenda** em um calendario real, preservando a integracao ja existente com o Google Agenda.
2. Adicionar no topo do CRM um atalho de agenda, ao lado do sino, que abra um mini calendario e os compromissos do dia.
3. Completar a integracao existente com a **Meta Conversions API** para devolver a Meta conversoes comerciais reais do CRM.
4. O envio da conversao sera **manual**, por botao, e nunca sera disparado apenas por mudanca de etapa ou status.
5. Cada oportunidade podera ter somente **um envio bem-sucedido** da conversao configurada.
6. Uma falha tecnica nao consumira o unico envio: sera permitido repetir a mesma tentativa com o mesmo identificador, sem duplicar a conversao na Meta.

## 2. Diagnostico do que ja existe

### Agenda — existente, mas parcial

Ja existem:

- rota `/app/calendar`;
- criacao, remarcacao, conclusao e cancelamento de compromissos;
- integracao OAuth com Google Calendar;
- criacao opcional de Google Meet;
- vinculo com contato, conversa e oportunidade;
- lembretes fixos de 24 horas e 1 hora pelo WhatsApp;
- banco `calendar_appointments` com data, horario, tipo, responsavel, status, local e link do Meet.

O que falta:

- visual de calendario mensal, semanal e diario;
- navegacao por data;
- filtros;
- atalho rapido no topo;
- resumo dos compromissos de hoje.

### Meta Conversions API — existente, mas incompatível com a decisao atual

Ja existem:

- pagina **Configuracoes → Conversoes da Meta**;
- Dataset/Pixel ID, token cifrado, versao da Graph API, moeda e codigo de teste;
- fila `meta_conversion_events`;
- worker com tentativas e registro da resposta da Meta;
- `event_id` unico para evitar duplicidade tecnica;
- normalizacao e hash de telefone/e-mail.

Problemas encontrados:

- o banco possui um gatilho que enfileira a conversao automaticamente quando a oportunidade muda para `won`;
- nao existe botao manual na oportunidade;
- nao existe tela de revisao do que sera enviado;
- o usuario nao ve claramente `nao enviado`, `enviando`, `enviado` ou `falhou`;
- a configuracao usa um unico nome de evento livre, com `Purchase` como valor inicial, sem explicar o marco comercial;
- ainda nao ha captura estruturada de identificadores de origem Meta como Lead ID, `fbc` e `fbp`; portanto a qualidade de correspondencia dependeria principalmente de telefone e e-mail quando esses identificadores nao existirem.

## 3. Decisoes funcionais

### 3.1 Onde ficara o botao da Meta

Local principal: **detalhes da oportunidade no Kanban**.

Motivo: a conversao representa o avanco comercial de uma oportunidade, nao apenas a existencia de um contato. Um contato pode ter mais de uma oportunidade.

Atalho adicional: no Inbox, o painel lateral podera mostrar o mesmo botao quando a conversa possuir uma oportunidade vinculada. Os dois locais chamarao o mesmo registro; nao serao dois envios independentes.

### 3.2 Comportamento do botao

Estado inicial:

- `Enviar conversao para Meta`.

Ao clicar:

1. abrir modal de revisao;
2. mostrar oportunidade, contato, evento, valor quando aplicavel e dados de correspondencia disponiveis;
3. exigir confirmacao explicita;
4. criar uma tentativa com `event_id` deterministico;
5. processar pelo servidor;
6. exibir o resultado.

Apos sucesso:

- botao fica bloqueado;
- texto passa para `Conversao enviada`;
- mostrar data, hora, evento e usuario que confirmou;
- nenhuma alteracao de etapa permitira novo envio.

Em caso de falha:

- mostrar o motivo em portugues;
- permitir `Tentar novamente`;
- reutilizar o mesmo registro e o mesmo `event_id`;
- nunca criar uma segunda conversao logica.

### 3.3 Regra de uma unica vez

Padrao recomendado para a primeira versao: **um envio bem-sucedido por oportunidade**.

A trava sera garantida no banco, e nao apenas escondendo o botao. Isso impede clique duplo, duas abas abertas e requisicoes simultaneas.

### 3.4 Evento enviado

Padrao recomendado: o administrador define em **Conversoes da Meta** qual marco real deseja devolver, com nome amigavel no CRM, por exemplo:

- Lead qualificado;
- Proposta aprovada;
- Venda fechada.

Para a primeira implantacao, escolheremos um unico marco por organizacao. O usuario revisa esse marco no modal, mas nao inventa um evento diferente em cada clique.

Importante: configurar a campanha na Meta para `conversion leads` e integrar o CRM sao etapas relacionadas, mas diferentes. O CRM devolve o dado; a campanha precisa ser configurada na Meta para usar esse dado na otimizacao.

## 4. Plano de execucao — Agenda

### Fase A1 — Calendario completo

- substituir a grade atual de cartoes por calendario real;
- disponibilizar visualizacoes **Mes**, **Semana**, **Dia** e **Lista**;
- botoes `Hoje`, anterior e proximo;
- clique em um dia/horario abre `Novo compromisso` com a data preenchida;
- clique em um compromisso abre o gerenciamento existente;
- manter status, contato, responsavel, local e Meet;
- cores por tipo ou status, com legenda acessivel;
- preservar fuso `America/Sao_Paulo` e ajustar corretamente mudancas de data.

### Fase A2 — Filtros e leitura

- filtrar por responsavel;
- filtrar por tipo: visita, consulta, reuniao online e outro;
- filtrar por status: agendado, remarcado, concluido, cancelado e nao compareceu;
- busca por contato ou titulo;
- no celular, usar a visualizacao em lista como padrao;
- no notebook, manter mes/semana legiveis sem corte horizontal.

### Fase A3 — Atalho ao lado do sino

- criar icone de calendario na barra superior;
- badge mostrara a quantidade de compromissos restantes de hoje;
- tooltip: `Agenda — X compromissos restantes hoje`;
- clique abre um popover, sem sair da pagina atual;
- popover contem mini calendario mensal e lista do dia selecionado;
- a data de hoje abre selecionada;
- itens mostram horario, titulo, contato e local ou Meet;
- acoes `Novo compromisso` e `Abrir Agenda completa`;
- se nao houver compromisso, mostrar estado vazio claro;
- badge da agenda tera significado diferente do sino: nao representa notificacao nao lida.

### Fase A4 — API e atualizacao

- reaproveitar `GET /api/v1/calendar/appointments` com intervalo do dia/mes;
- criar uma consulta leve para o resumo do topo, caso a rota completa fique pesada;
- atualizar o mini calendario apos criar, remarcar, concluir ou cancelar;
- atualizar em intervalo seguro e ao retornar o foco para a aba;
- nao criar uma segunda tabela de agenda: `calendar_appointments` ja e a fonte central.

## 5. Plano de execucao — Meta Conversions API

### Fase M1 — Corrigir a regra do banco

Nova migracao SQL:

- remover o trigger `trg_enqueue_meta_conversion_on_won`;
- impedir qualquer enfileiramento automatico por mudanca de status;
- adicionar autoria da confirmacao (`requested_by_user_id`);
- adicionar datas de solicitacao e confirmacao;
- adicionar resumo auditavel do evento;
- criar indice/trava unica que permita somente um envio logico por oportunidade;
- preservar filas antigas para auditoria, sem reenviar registros ja enviados.

### Fase M2 — Endpoint manual e idempotente

Criar uma rota autenticada para:

- consultar a elegibilidade da oportunidade;
- solicitar manualmente o envio;
- recusar oportunidade de outra organizacao;
- exigir perfil autorizado;
- devolver o estado atual caso o usuario clique novamente;
- aceitar repeticao apenas quando a tentativa anterior falhou;
- nunca criar outro `event_id` para a mesma conversao.

### Fase M3 — Qualidade dos dados

Enviar somente dados permitidos e disponiveis:

- telefone e e-mail normalizados e transformados em hash no servidor;
- identificador interno da oportunidade/contato como `external_id` quando permitido;
- horario real do marco confirmado;
- valor e moeda apenas quando fizerem sentido para o evento;
- identificadores Meta de origem, como Lead ID, `fbc` e `fbp`, somente quando realmente capturados — nunca fabricados.

O plano tambem inclui preparar o modelo de origem para preservar esses identificadores em futuros leads vindos da Meta. Sem eles, o envio ainda pode funcionar com telefone/e-mail, mas a correspondencia pode ser menor.

### Fase M4 — Configuracao compreensivel

Reorganizar **Configuracoes → Conversoes da Meta** em etapas:

1. conexao: Dataset ID e token;
2. conversao: marco comercial e evento enviado;
3. privacidade: consentimento e dados usados;
4. teste: codigo de evento de teste e validacao;
5. producao: ativacao definitiva.

Adicionar:

- teste da credencial sem expor o token;
- explicacao da diferenca entre evento de teste e producao;
- estado da conexao;
- ultimo envio, ultimo sucesso e ultimo erro;
- traducao dos erros da Meta para portugues.

### Fase M5 — Botao e modal

No dossie da oportunidade:

- badge do estado da conversao;
- botao manual;
- modal curto em etapas `Revisar → Confirmar → Resultado`;
- alerta caso telefone/e-mail ou consentimento exigido estejam ausentes;
- depois do sucesso, exibir comprovante e bloquear novo envio.

No Inbox:

- mostrar o mesmo controle apenas se houver oportunidade vinculada;
- se nao houver, oferecer `Criar oportunidade`, e nao enviar conversao a partir de uma conversa solta.

### Fase M6 — Worker, auditoria e seguranca

- manter processamento no servidor e token cifrado;
- manter retentativas com limite e backoff;
- registrar quem confirmou, quando, oportunidade, evento e resposta resumida;
- nao registrar token, telefone ou e-mail em texto puro nos logs;
- incluir a integracao na Saude do sistema;
- mostrar fila parada, credencial invalida e rejeicao da Meta.

## 6. Ordem recomendada para amanha

1. Separar e finalizar o commit/deploy pendente da migracao 0127 de notificacoes.
2. Implementar e executar a nova migracao da Meta, removendo o gatilho automatico.
3. Implementar endpoint manual, trava e testes de idempotencia.
4. Implementar botao/modal no Kanban e atalho no Inbox.
5. Validar no modo **Test Events** da Meta.
6. Somente depois do teste aprovado, retirar o codigo de teste e validar um evento real.
7. Implementar o calendario completo.
8. Implementar o mini calendario do topo.
9. Executar testes, commit, push, deploy e validacao autenticada no CRM.

## 7. Testes obrigatorios

### Agenda

- criar visita, consulta e Meet;
- abrir nas visoes mes, semana, dia e lista;
- verificar evento no Google Calendar;
- verificar badge e mini calendario;
- remarcar, cancelar e concluir;
- confirmar atualizacao imediata nas duas superficies;
- confirmar lembretes fixos e fuso horario;
- testar notebook e celular.

### Meta

- mudar etapa/status e comprovar que nada e enviado automaticamente;
- clicar, cancelar o modal e comprovar que nada foi criado;
- confirmar uma vez e visualizar o evento no Test Events;
- clicar novamente e comprovar bloqueio;
- simular duas requisicoes simultaneas e comprovar apenas um registro;
- simular erro da Meta e repetir com o mesmo `event_id`;
- verificar falta de telefone/e-mail e falta de consentimento;
- verificar isolamento entre organizacoes;
- confirmar auditoria do usuario;
- validar evento de producao e sua aparicao no Gerenciador de Eventos.

## 8. Criterios de pronto

Esta demanda somente estara concluida quando:

- Agenda tiver calendario real e atalho funcional no topo;
- compromissos do dia estiverem corretos no fuso da organizacao;
- mudanca de status nunca enviar conversao;
- conversao somente sair depois de confirmacao manual;
- uma oportunidade nao conseguir gerar duas conversoes bem-sucedidas;
- falhas puderem ser repetidas sem duplicacao;
- o evento aparecer no ambiente de teste da Meta;
- um evento real controlado aparecer no Gerenciador de Eventos;
- logs e tela explicarem claramente sucesso ou erro.

## 9. Decisoes adotadas para evitar bloqueio amanha

- **Trava:** um sucesso por oportunidade.
- **Local principal:** dossie da oportunidade no Kanban.
- **Atalho:** Inbox somente quando existir oportunidade vinculada.
- **Envio:** sempre manual e confirmado.
- **Falha:** permite repetir o mesmo evento; nao cria outro.
- **Agenda:** usa a tabela e a integracao Google ja existentes.
- **Badge do topo:** quantidade restante no dia, nao itens nao lidos.
- **Primeiro teste Meta:** obrigatoriamente com codigo de Test Events antes da producao.

## 10. Observacao sobre a conversa compartilhada

O link compartilhado do ChatGPT nao ficou acessivel durante esta analise. O ponto fornecido pelo usuario foi confrontado com a orientacao oficial da Meta: conectar dados posteriores do CRM pela Conversions API permite que a Meta aprenda quais leads realmente avancam, e a meta de desempenho `conversion leads` e configurada separadamente no Gerenciador de Anuncios.
