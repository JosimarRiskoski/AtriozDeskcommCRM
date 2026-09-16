# Plano de fundação: multiempresa e CORE + MESSAGING

## Objetivo

### Estado atual

Atualização de 11/09/2026: a implementação local de algumas fronteiras já foi iniciada e verificada — 17 testes de login e 6 testes de organização no envio passaram, com TypeScript e lint dos arquivos alterados aprovados. Isso não encerra a Fase 0: os testes usam dependências simuladas e ainda faltam confirmação do schema/ambiente correto, baseline operacional, validação remota e ensaio de restauração. Nenhum deploy ou migration foi executado.

### Meta ativa e autorização — atualização de 11/09/2026

Preparar e implementar, por fases, cadastro/login/convites/MFA, isolamento multiempresa, fronteira de código CORE/MESSAGING e posterior separação física dos bancos com resiliência comprovada. A meta permanece aberta até a entrega integral; concluir a documentação não conclui a implementação.

O usuário confirmou que `https://crm.atriozagencia.cloud` é ambiente de testes e autorizou seu uso para simular cadastro e login. A ausência de outra homologação não é mais bloqueio para esse ensaio. Preservar dados existentes; criar somente identidades/empresas sintéticas identificadas para o teste. Confirmar caixa de e-mail controlada antes do envio de confirmação; não inventar endereço de destinatário real.

Já autorizados: auditoria, preparação e mudanças locais de código, testes sem efeitos externos indevidos e ensaio de cadastro/login no ambiente indicado. Exigem autorização específica antes de executar: criação de infraestrutura/segundo banco, aplicação de migrations, deploy e mudanças de credenciais. Preparar scripts, diffs, riscos e rollback antes de apresentar cada autorização. Envios WhatsApp reais exigem destinatário e autorização próprios.

BeHub está fora do escopo. Não reutilizar seu banco, credenciais, dados ou conexões. Não iniciar `novocrmatrioz` apenas por ter sido encontrado no painel.

Preparar o CRM Atrioz para operar vários clientes de forma isolada e impedir que uma falha ou carga alta de WhatsApp impeça o uso das funções comerciais do CRM.

Não é uma alteração a ser aplicada parcialmente em produção. O plano deve ser executado em ambiente de teste, com uma etapa por vez e autorização antes de qualquer migração definitiva.

## Resultado desejado

- Cada cliente tem organização, usuários, credenciais, conexões de WhatsApp, dados e regras isolados.
- O usuário entra uma única vez no CRM.
- Se o sistema de mensagens ficar indisponível, login, contatos, Kanban, agenda e oportunidades continuam funcionando.
- A Inbox exibe claramente quando o serviço de mensagens está indisponível, sem perder mensagens ou duplicar envios.
- O frontend continua sendo um único CRM; a separação fica no backend.

## Arquitetura-alvo

```text
Frontend Atrioz
        |
API do CRM
   |              |
CORE          MESSAGING
```

### CORE

- autenticação e usuários;
- organizações, membros, papéis e permissões;
- contatos e dados comerciais;
- oportunidades, Kanban, agenda, tarefas, follow-ups, comissões e configurações;
- políticas e configurações de agentes de IA;
- registro de operação essencial e eventos de integração entre sistemas.

### MESSAGING

- sessões/canais de WhatsApp e seu estado operacional;
- conversas, mensagens, notas, recibos e metadados de mídia;
- webhooks de WhatsApp, eventos técnicos e logs de processamento;
- fila durável de envio, tentativas, deduplicação e falhas;
- execuções de IA vinculadas a conversas.

## Regras que não podem ser quebradas

1. Não haverá JOIN, chave estrangeira nem transação SQL entre CORE e MESSAGING.
2. `organization_id` é obrigatório em dados dos dois projetos; filtros e RLS continuam sendo a fronteira de segurança.
3. O browser não recebe chave de serviço nem acesso administrativo ao MESSAGING.
4. Toda entrega de webhook e todo envio têm identificador idempotente, para impedir mensagens ou jobs duplicados.
5. Falhas entre projetos são tratadas por eventos duráveis/reprocessáveis, nunca por tentativas invisíveis no navegador.
6. Nenhuma conexão, número, QR, conversa, mídia, chave ou dado de cliente pode ser reaproveitado por outro cliente.

## Plano de execução

### Fase 0 — inventário e baseline

- Revisar cadastro, login, confirmação de e-mail, convite, recuperação de senha, primeiro acesso e MFA; localizar o acesso público para criar conta e distinguir verificação de tela de ensaio completo.
- Usar a [auditoria de cadastro/login e multiempresa de 10/09/2026](AUDITORIA_FASE0_LOGIN_MULTIEMPRESA_2026-09-10.md) como registro de evidências e pendências, sem considerá-la prova de conclusão da Fase 0.
- Atualizar o inventário real de tabelas, RPCs, triggers, Edge Functions, API routes, workers, canais Realtime e integrações Evolution.
- Mapear toda dependência atual entre `contacts`, `conversations`, `messages`, IA e automações.
- Medir tráfego, volume, custo, latência, erros e assinaturas Realtime atuais.
- Definir ambiente de teste e dataset sem dados pessoais reais.

**Saída:** matriz de dependências, baseline e plano de rollback aprovados.

### Fase 1 — contrato de identidade e multiempresa

- Priorizar a jornada de nova empresa e de usuário convidado: provisionamento seguro e retomável, autorização no servidor, tratamento de falhas e teste completo em homologação. WhatsApp e IA indisponíveis não podem impedir acesso ao CORE.
- Consolidar `organization_id` como chave de isolamento em cada rota, tabela e evento que pertença a um cliente.
- Revisar RLS, membership, troca de organização ativa e auditoria de ações administrativas.
- Manter 2 fatores obrigatório para administradores, recomendado para gerentes e opcional para atendentes. O código só pode ser pedido ao iniciar uma nova sessão, nunca durante a navegação no CRM.
- Definir o provisionamento de um novo cliente: organização, primeiro administrador, domínio, segredo, conexão exclusiva, Redis/worker/volumes e backup.
- Criar testes automatizados de isolamento: um usuário/organização jamais lê ou altera dados de outro.

**Saída:** multiempresa comprovado no mesmo banco, antes de separar mensagens.

### Fase 2 — fronteira CORE ↔ MESSAGING

- Definir contratos versionados para `conversation`, `message`, `receipt`, `channel-status` e `contact-reference`.
- Criar um registro de eventos/outbox no CORE e uma fila de processamento no MESSAGING, com retries, backoff, dead-letter e métricas.
- Definir o mínimo de dados duplicados no MESSAGING: identificadores compartilhados e resumo necessário à Inbox; nunca o cadastro completo sem necessidade.
- Criar adaptadores no código (`services/core` e `services/messaging`) para impedir chamadas espalhadas aos dois projetos.

**Saída:** comunicação entre projetos validada com falha simulada e recuperação idempotente.

### Fase 3 — extrair MESSAGING em ambiente de teste

- Criar projeto Supabase MESSAGING separado, com Storage de mídia, RLS, índices e backup próprios.
- Migrar primeiro uma organização de teste e apenas dados sintéticos ou cópia autorizada.
- Alterar a API do CRM para agregar, em paralelo quando apropriado, dados comerciais do CORE e conversa/mensagens do MESSAGING.
- Manter paginação por cursor de mensagens e Realtime por organização/conversa, com cleanup de canais.

**Saída:** fluxo completo comprovado: login → Inbox → receber → responder → entregue/lida → IA → reconexão.

### Fase 4 — resiliência e operação

- Simular indisponibilidade do MESSAGING: CORE precisa permanecer utilizável e a Inbox informar indisponibilidade sem travar o CRM.
- Simular indisponibilidade do CORE: impedir ações sem autorização, preservar jobs de mensagens com segurança e expor estado claro.
- Testar duplicação de webhook, retry, reprocessamento, reinício de worker, restauração de backup e rollback da aplicação.
- Criar painel operacional com profundidade/idade da fila, falhas, mensagens pendentes, webhook recebido e atrasos.

**Saída:** evidência de isolamento, recuperação e operação antes de migrar clientes reais.

### Fase 5 — migração controlada

- Migrar uma organização piloto com janela, backup verificável e rollback.
- Comparar contagens, integridade de conversas/mensagens, status de recebimento e permissões.
- Só depois migrar as demais organizações em lotes.

## Critérios para autorizar migração de cliente real

- Testes de isolamento multiempresa aprovados.
- Backup e restauração de ambos os projetos testados.
- Envio/recebimento/recibos/IA/reconexão aprovados em teste.
- Falha de MESSAGING não bloqueia CORE.
- Eventos duplicados não duplicam mensagem, contato ou envio.
- Métricas e alertas operacionais visíveis.
- Rollback documentado e ensaiado.

## Ordem operacional e entregas verificáveis

| Etapa | Trabalho concreto | Aceite | Reversão / ponto de autorização |
|---|---|---|---|
| 0 | Conferir HEAD e alterações locais; confirmar banco ligado ao ambiente de testes; inventariar schema real, funções, policies, triggers, Storage, Realtime, webhooks e workers; medir baseline | Matriz de dependências, schema reproduzível, métricas e roteiro de restauração registrados | Somente leitura e documentação; ensaio de restauração não sobrescreve instalação atual |
| 1A | Melhorar acesso Criar minha empresa; separar convite; corrigir retomada de provisionamento, mensagens de erro, destinos internos e MFA no servidor | Cadastro → e-mail → empresa única → MFA → CRM; convite sem empresa extra; nova sessão protegida e navegação sem novo desafio | Mudanças locais pequenas; migration/deploy somente após autorização; não reabrir falha de segurança no rollback |
| 1B | Contexto obrigatório de organização em APIs e workers; RLS/grants/RPCs; integridade de referências; troca de empresa e provisionamento | Duas empresas isoladas, incluindo usuário admin em A e viewer em B; testes de leitura/escrita, revogação, mídia e Realtime | Schema aditivo compatível; preservar versão anterior e dados; aprovação antes de aplicar SQL |
| 2A | Criar interfaces CORE e MESSAGING usando ainda o banco atual; concentrar acesso aos dados por domínio. Contratos iniciais estão em `lib/services/core/contracts.ts` e `lib/services/messaging/contracts.ts` | Comportamento e resultados preservados; dependências diretas cruzadas identificadas e eliminadas da aplicação | Alternar implementação por configuração mantendo um único escritor; sem migração física |
| 2B | Outbox transacional, contratos versionados, fila de envio e entrada durável; retries, leases, dead-letter, limites por empresa | Duplicação/reinício não duplica efeito; envio incerto é reconciliado; ordem de recibos preservada | Pausar consumidor novo, reconciliar pendências e retomar consumidor único |
| 3 | Provisionar MESSAGING após aprovação; migrar empresa sintética; implementar identidade, projeções, API e Realtime | Fluxo completo de mensagens/IA/mídia sem JOIN/FK/transação entre projetos e sem chave administrativa no browser | Backup, marco de corte e reconciliação; novas escritas impedem simples retorno por troca de URL |
| 4 | Simular falhas por domínio e saturação por empresa; restaurar backups em destino separado; validar alertas | CORE utilizável sem MESSAGING; autorização falha fechada sem CORE; trabalho durável recuperado | Falhas inicialmente injetadas no código de teste; interrupção de serviço compartilhado precisa de janela autorizada |
| 5 | Piloto e expansão, somente com autorização e escopo de dados definidos | Integridade, permissões, mídia e pendências reconciliadas; janela de observação aprovada | Um escritor por organização, interrupção do corte se divergente e retorno ensaiado |

### Contratos a fechar antes de mover dados

- Identidade: Auth permanece no CORE. MESSAGING recebe contexto confiável e restrito de organização/ator; definir autorização de Realtime sem presumir compatibilidade automática do JWT entre projetos.
- Eventos: `event_id`, `organization_id`, versão, tipo, entidade, instante, correlação e versão/ordem por entidade. Consumidor registra deduplicação junto ao efeito local.
- Contatos: CORE é autoridade; MESSAGING mantém apenas referência e resumo necessário. Bloqueio, exclusão e permissão de envio têm versão e política conservadora se não for possível confirmar autorização.
- Entrada: ACK somente após persistência suficiente para reprocessar. Recebimento pode aguardar resolução do contato no CORE sem perder o evento.
- Saída: identificador estável da intenção de envio em todos os caminhos, inclusive envio manual. Timeout após aceitação pelo provedor gera estado incerto e reconciliação, nunca reenvio cego.
- LGPD e merge: protocolo durável com confirmação em cada domínio, tombstones e prevenção de ressurreição por evento atrasado. Nenhuma exclusão distribuída é considerada concluída só pelo CORE.
- IA: políticas, versões e limites no CORE; execução de conversa no MESSAGING. Ferramentas comerciais passam por autorização CORE; definir reserva/reconciliação de orçamento sem consultas ilimitadas ao CORE.
- Recursos: separar capacidade/pools/processos e limitar carga por empresa; dois bancos no mesmo servidor de aplicação não bastam para garantir resiliência.

### Testes de regressão obrigatórios em cada etapa afetada

- Inbox: cursor, notas, contagens/filtros coerentes, assumir/liberar/pausar IA, leitura e recibos monotônicos.
- Realtime: autenticação antes de assinar, reconexão com recuperação, cleanup e troca de organização sem cache ou canal residual.
- Kanban: ordenação, atualização agrupada, criação de oportunidade e motivo de perda/detalhe.
- Login: erros transitórios não apagam sessão nem mascaram indisponibilidade como senha incorreta; MFA não é contornável por API direta.
- Isolamento: organização do recurso coincide com a organização autorizada, inclusive com service role e SQL direto; referências cruzadas são rejeitadas.
- Desempenho: comparar mesma carga/dataset antes e depois. Registrar p50/p95/p99, taxa de erro, fila e consumo; fixar limites numéricos após baseline, antes de aceitar a mudança.

### Controle da execução

- Estado inicial: auditoria preliminar entregue; implementação local iniciada e verificada apenas nos limites registrados acima. Fase 0 não encerrada.
- Checkpoint local de 14/09/2026: destinos seguros de autenticação, retomada de provisionamento de cadastro comum, MFA de administrador no servidor/onboarding, verificações explícitas de organização em mensagens/conversas/oportunidades e dispatcher paralelo de eventos foram preparados no código. Os testes focados, `tsc --noEmit` e `pnpm run build` passaram. Não substitui homologação com e-mail controlado, duas organizações, Realtime, Evolution ou banco remoto.
- Para cada etapa registrar arquivos alterados, testes executados/resultados, evidência do ambiente, riscos e pendências. Teste não executado não conta como aprovado.
- Revalidar o estado do repositório antes de editar: as correções recentes podem ter sido commitadas por outra tarefa. Não restaurar snapshots antigos por cima delas.
- Não ampliar o escopo para billing, planos comerciais, pagamentos ou reconstrução visual completa sem necessidade aprovada.
- Próximo trabalho: concluir inventário/baseline e iniciar preparação local da Fase 1A; execução de cadastro real de teste depende de caixa de e-mail controlada disponível. O desenho de schema e corte futuro está registrado em `docs/PREPARACAO_SCHEMA_CORE_MESSAGING_2026-09-14.md` e não autoriza sua aplicação.

## Fora de escopo agora

- Criar segundo Supabase ou migrar tabelas reais.
- Mover segredos ou reutilizar conexão/WhatsApp do proprietário.
- Fazer deploy em produção.
- Alterar a BeHub: ela continuará com infraestrutura e dados próprios.

## Prompt de continuidade para um novo chat

> Retome a meta ativa usando este plano e a auditoria de cadastro/login. Trabalhe somente no AtriozDeskcommCRM e confira primeiro o estado atual do código. O usuário autorizou crm.atriozagencia.cloud como ambiente de testes, incluindo ensaio de cadastro/login. Conclua a Fase 0 e avance na preparação local da Fase 1A, depois isolamento multiempresa, separação do código, comunicação durável e separação física. Não crie infraestrutura, aplique migrations, faça deploy ou altere credenciais sem autorização específica. Preserve dados existentes, correções de Inbox/performance/Kanban e exclua BeHub. Não confunda plano pronto com implementação concluída.
