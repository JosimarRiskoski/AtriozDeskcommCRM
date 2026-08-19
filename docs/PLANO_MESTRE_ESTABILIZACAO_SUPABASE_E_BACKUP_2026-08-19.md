# Plano mestre — estabilização do Supabase, Inbox em tempo real e backup recuperável

**Projeto:** Átrioz CRM  
**Data:** 19/08/2026  
**Estado:** Janela 1 implementada e implantada; validação autenticada em andamento  
**Regra desta etapa:** a Janela 1 autorizou somente as correções de recuperação descritas; limpeza destrutiva, restauração e troca de banco continuam proibidas até a Janela 2 com Josimar presente.

## Limite operacional combinado em 19/08/2026

Este plano será executado em duas janelas separadas:

### Janela 1 — hoje, execução autônoma

Objetivo único: fazer o CRM atual voltar a abrir, autenticar e operar sem a lentidão causada pelo excesso de consultas.

Está autorizado, depois que a meta for ativada:

- registrar a fotografia técnica inicial;
- corrigir o polling excessivo do Inbox;
- corrigir o polling excessivo da fila da IA;
- remover processos vazios ou redundantes já comprovados;
- aliviar health checks que consultam o banco desnecessariamente;
- testar, commitar, enviar e implantar apenas as correções necessárias para recuperar o CRM;
- acompanhar login, Inbox, CPU, I/O, consultas e erros após o deploy.

A Janela 1 termina quando o CRM atual puder ser acessado e usado sem lentidão anormal. Se isso não for atingido com segurança, a execução deve parar com diagnóstico e handoff, sem iniciar migração.

### Execução registrada em 19/08/2026

- Inbox: fallback passou de duas consultas a cada 2 segundos para 60 segundos com Realtime saudável e 10 segundos quando degradado; foco e reconexão continuam forçando uma conferência imediata.
- Realtime: uma assinatura sem autenticação deixa de ser tratada falsamente como saudável.
- Worker: consulta ociosa passou de 250 ms fixos para backoff entre 1 e 10 segundos, reiniciado imediatamente quando há trabalho.
- Saúde: `/healthz` não consulta mais o banco e `/readyz` faz somente `select 1`.
- Scheduler: chamada permanente e vazia do `agent-dispatcher` removida.
- Validação local: 10 testes unitários direcionados, typecheck e build aprovados.
- Publicação: commits `ddd37b06` e `cb1619b0` enviados e deploy de `cb1619b0` concluído.
- Prova pública: login respondeu HTTP 200 em aproximadamente 0,90 s e carregou visualmente em aproximadamente 0,9 s sem erros no console.
- Prova autenticada: aguardando Josimar concluir o login manual para validar navegação, lista do Inbox e abertura de conversa.

### Janela 2 — amanhã, com Josimar presente

Começa no antigo ponto 4 do plano de migração: criação do Supabase definitivo na conta/organização do Chico.

Ficam proibidos durante a Janela 1:

- criar projeto ou organização Supabase para o Chico;
- restaurar dados em outro Supabase;
- trocar URL, chave pública, chave administrativa ou conexão de banco no EasyPanel;
- transferir Auth, Storage ou configurações de produção;
- apontar o CRM para o banco novo;
- apagar, pausar ou encerrar o Supabase atual.

Essas ações só poderão ocorrer amanhã, com Josimar acompanhando e aprovando cada etapa de migração e corte.

## 1. Resultado esperado

Ao concluir este plano, o sistema deverá:

1. receber mensagens no Inbox em tempo real, sem depender de consultas a cada 2 segundos;
2. continuar se recuperando automaticamente quando o Realtime cair;
3. parar de consultar a fila de IA quatro vezes por segundo quando não houver trabalho;
4. eliminar crons sem função e reduzir execuções vazias;
5. manter auditoria, LGPD, campanhas, follow-ups, agenda, IA e Meta CAPI funcionando;
6. reduzir fortemente o egress e o número de consultas do Supabase;
7. possuir backup completo, verificável e restaurável em outro projeto;
8. possuir um SQL portátil de emergência, sem colocar dados pessoais no Git;
9. comprovar uma restauração antes de considerar qualquer mudança do banco usado em produção.

## 2. Diagnóstico que fundamenta o plano

### 2.1 Inbox

Foram encontrados dois polling fixos de 2 segundos:

- `hooks/inbox/useConversationsRealtime.ts`: relê a lista de conversas;
- `hooks/inbox/useMessagesRealtime.ts`: relê as mensagens da conversa aberta.

Com uma conversa aberta, são aproximadamente duas requisições a cada 2 segundos, ou **86.400 requisições por dia por aba ativa**. O Realtime já existe, portanto o polling está funcionando como caminho principal disfarçado de contingência.

### 2.2 Fila do agente de IA

O `agent-worker` executa `claimJobs()` com intervalo padrão de 250 ms. Mesmo sem trabalho, cada rodada abre transação, adquire lock e conta jobs em execução.

- 4 verificações por segundo;
- 240 por minuto;
- 14.400 por hora;
- 345.600 por dia por processo worker.

Os aproximadamente 1,95 milhão de `count(*)` observados são compatíveis com cerca de 5,6 dias de um único worker ocioso.

### 2.3 Scheduler

O Compose do EasyPanel executa vários endpoints a cada minuto. Parte deles é legítima, mas o `agent-dispatcher` está marcado no próprio código como `deprecated` e `NO-OP permanente`, embora continue sendo chamado todo minuto.

### 2.4 Health check

O EasyPanel chama `/healthz` do worker a cada 30 segundos. O endpoint consulta agrupamentos da fila e métricas no banco. Saúde básica do processo não deveria gerar consultas de negócio a cada verificação.

### 2.5 Auditoria

`api_audit_log` recebe registros de aproximadamente 183 pontos de chamada no código e também de triggers do banco. Parte é obrigatória para segurança e LGPD. Antes de alterar retenção, será necessário medir volume por `action`, origem e período. Não será feita limpeza cega.

### 2.6 Situação do Supabase

O banco possui tamanho baixo em relação ao limite. O excesso está concentrado em egress e quantidade de chamadas. Portanto, trocar apenas o banco não elimina a causa: o novo projeto seria submetido ao mesmo padrão de consumo.

## 3. Princípios obrigatórios da execução

- Nenhuma mensagem real pode depender exclusivamente de polling.
- Realtime será o caminho principal; fallback será uma rede de segurança.
- Nenhuma otimização pode perder mensagens, duplicar respostas da IA ou campanhas.
- Nenhum log obrigatório de LGPD será apagado sem backup e política aprovada.
- Nenhum dado pessoal, senha, chave, dump ou SQL com dados será commitado.
- O banco atual continuará sendo a fonte de verdade até a restauração ser comprovada.
- Cada fase terá teste e ponto de parada próprio.
- Se uma fase falhar, o deploy daquela fase será revertido sem avançar para a seguinte.

## 4. Fase 0 — fotografia inicial e proteção

### Ações

1. Registrar antes das mudanças:
   - egress acumulado e diário;
   - chamadas das 20 consultas mais frequentes;
   - conexões Realtime;
   - quantidade de mensagens recebidas/enviadas nas últimas 24 horas;
   - filas por status (`pending`, `running`, `failed`, `dead`);
   - eventos pendentes e mortos;
   - erros recentes do Inbox, webhook e worker.
2. Confirmar no EasyPanel:
   - uma réplica do `app`;
   - uma réplica do `worker`;
   - uma réplica do `scheduler`;
   - ausência de Compose antigo ainda executando;
   - ausência de crons Vercel ativos contra o mesmo banco.
3. Criar um backup lógico inicial somente leitura antes da primeira alteração.
4. Calcular hashes e registrar contagens do backup.

### Critério de saída

- fotografia inicial salva;
- backup inicial legível;
- topologia real de serviços confirmada;
- nenhuma duplicidade de scheduler desconhecida.

## 5. Fase 1 — estabilização imediata do Inbox

### Mudança proposta

Remover o polling fixo de 2 segundos da lista e das mensagens. Manter:

1. Realtime para eventos de `conversations` e `messages`;
2. atualização imediata quando o evento chegar;
3. atualização ao abrir ou trocar de conversa;
4. atualização ao voltar para a aba do navegador;
5. atualização após reconexão do canal;
6. fallback espaçado apenas quando houver falha, timeout ou divergência;
7. backoff progressivo durante indisponibilidade, sem tempestade de retries.

### Comportamento do fallback

- canal saudável: sem polling contínuo;
- canal reconectando: conferir após 5 segundos;
- falhas consecutivas: 10, 20 e 30 segundos, limitado a 60 segundos;
- retorno da aba: uma conferência imediata;
- evento Realtime recebido: invalidar apenas as consultas afetadas;
- erro 429, 5xx ou timeout: respeitar backoff e não abrir várias requisições simultâneas.

### Arquivos previstos

- `hooks/inbox/useConversationsRealtime.ts`;
- `hooks/inbox/useMessagesRealtime.ts`;
- `hooks/realtime/useRealtimeChannel.ts`;
- `hooks/realtime/useRefetchDeSeguranca.ts`;
- testes dos hooks e do Inbox.

### Testes obrigatórios

1. Enviar 20 mensagens alternadas pelos dois números conectados.
2. Validar mensagens de entrada e saída.
3. Manter duas abas abertas e validar que não há duplicação.
4. Ocultar a aba por cinco minutos e retornar.
5. Interromper temporariamente o socket e validar recuperação.
6. Confirmar ordem, anexos, áudio, recibos e contagem de não lidas.
7. Confirmar que a IA recebe a mensagem somente uma vez.

### Critério de aceite

- zero mensagem ausente nos testes;
- atualização normal em até 3 segundos quando o Realtime estiver saudável;
- recuperação automática após falha;
- redução superior a 95% nas consultas geradas pelo Inbox ocioso.

## 6. Fase 2 — fila da IA orientada por evento

### Etapa 2A — proteção imediata

Antes da solução definitiva, aumentar o intervalo ocioso e implementar backoff adaptativo:

- trabalho encontrado: continuar processando sem atraso artificial;
- fila vazia: 1, 2, 5, 10 e até 30 segundos;
- novo trabalho: zerar o backoff.

Esta etapa reduz imediatamente o consumo e permanece segura mesmo antes do mecanismo de despertar.

### Etapa 2B — despertar por evento

Implementar `LISTEN/NOTIFY` no Postgres para avisar o worker quando surgir um job elegível:

1. trigger pequeno em `job_queue` para `INSERT` ou retorno a `pending`;
2. payload sem dados pessoais — somente sinal de que há trabalho;
3. conexão dedicada do worker em modo compatível com `LISTEN`;
4. ao receber o aviso, executar `claimJobs()` imediatamente;
5. manter fallback lento de 30 segundos para recuperação de aviso perdido;
6. manter lock, `SKIP LOCKED`, leases e idempotência atuais.

Se a conexão atual usar um pooler incompatível com `LISTEN`, será usada conexão de sessão própria ou permanecerá o backoff adaptativo, sem arriscar a fila.

### Migração provável

- próxima migration versionada após `0129`;
- apêndice idempotente no `supabase/baseline.sql`;
- registro no `supabase/migrations/MANIFEST.md`.

### Testes obrigatórios

- fila vazia por 15 minutos;
- entrada de job com worker ocioso;
- 50 jobs simultâneos;
- dois workers concorrentes em ambiente de teste;
- reinício durante processamento;
- lease expirado;
- job duplicado com o mesmo evento de origem;
- inbound da Evolution até resposta da IA.

### Critério de aceite

- job novo percebido normalmente em menos de 1 segundo;
- fila vazia gera no máximo uma consulta de recuperação a cada 30 segundos;
- nenhum processamento duplicado;
- nenhuma perda após reinício.

## 7. Fase 3 — scheduler e processos vazios

### Mudanças

1. Remover `agent-dispatcher` do scheduler do EasyPanel.
2. Remover a declaração equivalente dos crons Vercel, caso ainda exista.
3. Confirmar que o drain nativo do agente continua sendo o único consumidor de `ai_agent.dispatch_requested`.
4. Revisar cada cron de minuto:
   - inbound recovery;
   - follow-up;
   - agenda;
   - campanhas;
   - Meta CAPI;
   - notificações;
   - event log.
5. Manter frequência de um minuto somente onde o prazo de negócio realmente exige.
6. Não gerar auditoria para tick vazio.
7. Impedir sobreposição quando uma execução anterior ainda estiver rodando.

### Critério de aceite

- nenhum cron obsoleto;
- nenhuma execução paralela do mesmo trabalho;
- nenhum heartbeat vazio gravando log de negócio;
- campanhas, lembretes, notificações, CAPI e follow-up continuam operacionais.

## 8. Fase 4 — health check sem carga de negócio

### Mudança

Separar:

- `/healthz`: confirma processo vivo e conexão básica sem agregações;
- `/readyz`: verifica se o worker está apto a receber trabalho;
- `/metrics`: consulta métricas somente quando alguém abrir o diagnóstico ou um monitor solicitar.

O health check do EasyPanel deverá usar o endpoint barato.

### Critério de aceite

- health check não executa contagens completas da fila a cada 30 segundos;
- EasyPanel detecta processo parado;
- métricas operacionais continuam disponíveis separadamente.

## 9. Fase 5 — auditoria e retenção controlada

### Diagnóstico antes da alteração

Agrupar `api_audit_log` por:

- `action`;
- dia e hora;
- origem/API;
- registros com `organization_id` nulo;
- tamanho estimado de `metadata`;
- ações técnicas versus ações de negócio.

### Correções possíveis após a medição

1. manter auditoria de segurança, LGPD, autenticação e mutações reais;
2. não auditar leitura comum nem execução vazia;
3. reduzir metadata redundante e payload excessivo;
4. criar política de armazenamento quente e arquivo externo;
5. somente arquivar ou remover registros antigos depois de:
   - exportação;
   - hash;
   - teste de leitura;
   - aprovação explícita.

### Critério de aceite

- crescimento diário previsível;
- nenhuma perda de rastreabilidade obrigatória;
- ausência de logs técnicos repetitivos sem valor de negócio.

## 10. Fase 6 — payload, paginação e acesso administrativo

### Revisões

1. Confirmar que as APIs do Inbox selecionam apenas colunas exibidas.
2. Manter paginação real de 50 itens sem reler páginas antigas.
3. Evitar invalidação global de todas as conversas quando apenas uma mudou.
4. Revisar endpoints que usam `service_role` e confirmar:
   - uso apenas no backend;
   - filtro explícito por organização;
   - ausência de chave no navegador;
   - ausência de consultas amplas desnecessárias.
5. Revisar endpoints de contagem, retenção e painel lateral para evitar múltiplas leituras do mesmo dado.

### Critério de aceite

- respostas menores;
- nenhuma consulta cross-tenant acidental;
- nenhuma chave administrativa exposta;
- quantidade de linhas processadas compatível com a tela.

## 11. Fase 7 — observação após deploy

### Janela

- verificação imediata após deploy;
- nova leitura após 1 hora;
- comparação após 6 horas;
- validação final após 24 horas.

### Indicadores

- chamadas de `job_queue` por hora;
- chamadas PostgREST por hora;
- egress diário projetado;
- erros 4xx/5xx;
- latência do Inbox;
- divergências entre Realtime e fallback;
- mensagens recebidas, processadas e respondidas;
- backlog de jobs e eventos;
- consumo de auditoria.

### Meta

- redução mínima de 80% no volume total de chamadas;
- redução superior a 95% nos pollings identificados;
- projeção de egress abaixo do limite do plano com margem;
- zero perda ou duplicação nos testes ponta a ponta.

## 12. Fase 8 — pacote de backup recuperável

O backup terá dois formatos complementares.

### 12.1 Formato oficial de restauração

Arquivos separados conforme o processo recomendado pelo Supabase:

- `roles.sql`;
- `schema.sql`;
- `data.sql` usando `COPY`;
- histórico de migrations;
- diferenças controladas em `auth` e `storage`, se existirem;
- inventário de configurações externas.

Esse será o formato principal por ser mais confiável e rápido para restaurar.

### 12.2 Mega SQL portátil

Será produzido um SQL único de emergência contendo:

1. cabeçalho de segurança e versão;
2. extensões necessárias;
3. estrutura pública idempotente;
4. funções, triggers, políticas e índices;
5. dados em ordem compatível com as dependências;
6. ajuste de sequências;
7. validações finais e contagens esperadas.

O mega SQL:

- não será commitado;
- será armazenado em pasta local protegida;
- poderá ser compactado e criptografado;
- terá hash SHA-256;
- não conterá senhas nem chaves de API;
- não será considerado válido até ser restaurado em um banco vazio.

### 12.3 Storage

O dump do banco inclui metadados dos buckets, mas não inclui os arquivos físicos. Portanto haverá exportação separada dos objetos do Storage, com inventário de caminhos, tamanho e hash.

### 12.4 Configurações fora do banco

Será criado inventário, sem revelar os valores secretos, de:

- variáveis do EasyPanel;
- Evolution API;
- Google Calendar OAuth;
- OpenAI e demais provedores;
- Resend;
- Meta CAPI;
- domínios e callbacks;
- configurações de Auth;
- configurações de Realtime;
- webhooks;
- volumes persistentes da Evolution.

## 13. Fase 9 — restauração em um segundo projeto Supabase

### Ordem

1. Criar projeto de destino isolado.
2. Não conectar o CRM de produção nesse momento.
3. Aplicar extensões e configurações necessárias.
4. Restaurar roles, schema e dados.
5. Restaurar histórico de migrations.
6. Restaurar ajustes próprios de `auth` e `storage`.
7. Migrar arquivos físicos do Storage.
8. Recriar Auth, Realtime, chaves, callbacks e webhooks necessários.
9. Manter quaisquer tarefas externas desativadas para não enviar mensagens, lembretes, campanhas ou conversões durante o teste.
10. Comparar banco fonte e destino.

### Comparações obrigatórias

- contagem por tabela;
- contatos, conversas e mensagens por organização;
- últimos e primeiros registros por data;
- vínculos entre usuários, organizações e responsáveis;
- campanhas e destinatários;
- agentes, versões e conhecimento;
- agenda e lembretes;
- auditoria e event log;
- Storage por bucket;
- funções, triggers, índices e RLS;
- checksum amostral de registros críticos.

### Critério de aceite

- contagens compatíveis;
- zero chave estrangeira quebrada;
- login de usuário de teste funcionando;
- Inbox histórico íntegro;
- nenhuma integração externa disparada durante o ensaio;
- relatório de restauração assinado com data e hashes.

## 14. Fase 10 — decisão sobre troca de banco

A existência do backup não obriga a trocar o banco de produção.

### Permanecer no banco atual

É a opção recomendada se, após as otimizações:

- o CRM voltar a operar normalmente;
- o egress projetado ficar dentro do limite;
- não houver restrição ativa;
- o banco atual estiver íntegro.

### Trocar para o banco restaurado

Somente será considerado se:

- a restauração tiver passado em todos os testes;
- houver janela de manutenção;
- for feito backup final imediatamente antes da troca;
- entradas de WhatsApp forem temporariamente controladas;
- as variáveis do app e worker forem atualizadas juntas;
- o banco antigo permanecer preservado para rollback;
- houver teste ponta a ponta após a troca.

## 15. Ordem recomendada de commits e deploys

1. **Commit A — Inbox:** Realtime principal e fallback controlado.
2. **Commit B — worker:** backoff imediato e testes.
3. **Commit C — fila por evento:** migration + LISTEN/NOTIFY, se validado.
4. **Commit D — scheduler e health:** remover NO-OP e aliviar health check.
5. **Commit E — auditoria/payload:** somente após medição.
6. **Operação separada — backup/restauração:** arquivos nunca entram no Git.

Cada commit será construído, testado e implantado isoladamente. Não será feito um deploy único com todas as mudanças misturadas.

## 16. Rollback

- Inbox: restaurar o comportamento anterior apenas se o Realtime/fallback reprovar, com polling temporário mais espaçado e monitorado.
- Worker: manter fallback por tempo caso `LISTEN/NOTIFY` falhe.
- Scheduler: recolocar somente o cron cuja ausência causar regressão comprovada.
- Banco: não alterar a fonte de verdade antes da restauração aprovada.
- Deploy: manter identificação do commit anterior estável para retorno rápido.

## 17. O que não será feito

- não apagar conversas, contatos ou mensagens para reduzir egress;
- não limpar logs imutáveis sem exportação e aprovação;
- não apontar o CRM diretamente para um banco vazio;
- não colocar dumps ou dados pessoais no GitHub;
- não esconder erro de Realtime com polling agressivo;
- não desligar auditoria obrigatória;
- não misturar correção de consumo com novas funcionalidades;
- não considerar backup concluído sem teste de restauração.

## 18. Aprovação solicitada

A aprovação deste plano autorizará, na ordem descrita:

1. criar a fotografia inicial e o backup preventivo;
2. corrigir Inbox e fallback;
3. corrigir o worker e a fila;
4. corrigir scheduler e health check;
5. medir e tratar auditoria/payload;
6. observar o uso por 24 horas;
7. gerar o pacote de backup e o mega SQL;
8. restaurar em um projeto separado para validação;
9. apresentar resultado antes de qualquer possível troca de banco.

## Referências oficiais

- [Supabase — Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase — Migrating within Supabase](https://supabase.com/docs/guides/platform/migrating-within-supabase)
- [Supabase — Database Backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase — Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)
