# Plano de fundação: multiempresa e CORE + MESSAGING

## Objetivo

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

- Atualizar o inventário real de tabelas, RPCs, triggers, Edge Functions, API routes, workers, canais Realtime e integrações Evolution.
- Mapear toda dependência atual entre `contacts`, `conversations`, `messages`, IA e automações.
- Medir tráfego, volume, custo, latência, erros e assinaturas Realtime atuais.
- Definir ambiente de teste e dataset sem dados pessoais reais.

**Saída:** matriz de dependências, baseline e plano de rollback aprovados.

### Fase 1 — contrato de identidade e multiempresa

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

## Fora de escopo agora

- Criar segundo Supabase ou migrar tabelas reais.
- Mover segredos ou reutilizar conexão/WhatsApp do proprietário.
- Fazer deploy em produção.
- Alterar a BeHub: ela continuará com infraestrutura e dados próprios.

## Prompt de continuidade para um novo chat

> Use `docs/PLANO_FUNDACOES_MULTIEMPRESA_CORE_MESSAGING.md` como plano de referência. Trabalhe somente no AtriozDeskcommCRM. Comece pela Fase 0 em modo de auditoria: inventarie dependências de multiempresa e de mensagens, confirme o que já existe e produza uma matriz de dependências e um baseline. Não crie banco, não mova dados, não altere RLS, não faça deploy e não aplique migrações sem minha autorização explícita. Preserve a BeHub fora deste escopo.
