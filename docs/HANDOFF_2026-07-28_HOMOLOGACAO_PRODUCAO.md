# Handoff Atrioz DeskcommCRM — 28/07/2026

## 1. Resumo executivo

O pacote grande de melhorias foi implementado no fork Atrioz, integrado ao GitHub, publicado pelo EasyPanel e teve sua base nova aplicada no Supabase. A rota de campanhas já apareceu na produção e a validação de um CSV de teste funcionou corretamente.

Porém, **o sistema ainda não pode ser declarado pronto para clientes**. “Implementado” significa que o recurso existe no código; “comprovado” significa que passou por um teste real, ponta a ponta, no ambiente publicado. Ainda faltam várias comprovações ao vivo.

O bloqueio técnico imediato é:

- o serviço `app` tenta gravar auditoria e recebe `new row violates row-level security policy for table "api_audit_log"`;
- a hipótese principal já identificada é que `SUPABASE_SERVICE_ROLE_KEY` no EasyPanel está incorreta ou contém a chave pública/anon;
- nenhuma chave deve ser registrada neste documento;
- o provedor de IA também ainda não está configurado: os logs informam ausência de `AI_GATEWAY_API_KEY`/`ANTHROPIC_API_KEY` e `OPENAI_API_KEY`.

**Primeira tarefa de amanhã:** corrigir a `SUPABASE_SERVICE_ROLE_KEY`, reimplantar e confirmar que os erros de auditoria desapareceram. Não iniciar homologação dos outros módulos antes disso.

---

## 2. Fontes oficiais do projeto

- Fork oficial de personalização: `JosimarRiskoski/AtriozDeskcommCRM`
- Repositório original usado apenas como upstream monitorado: `melgarafael/DeskcommCRM`
- Repositório local: `C:\Projetos\AtriozDeskcommCRM`
- Branch atual de trabalho: `codex/roadmap-fundacoes`
- Commit publicado no momento deste handoff: `d1f910f`
- Plano mestre: `C:\Projetos\CLIENTES\BeHub - Energia Solar Chico\CRM\wacrm\wacrm-main\docs\PLANO_MELHORIAS_DESKCOMMCRM_MODULO_POR_MODULO.md`
- Auditoria técnica do pacote: `C:\Projetos\AtriozDeskcommCRM\docs\AUDITORIA_ROADMAP_ATRIOZ.md`
- Instruções de entrega: `C:\Projetos\AtriozDeskcommCRM\docs\ENTREGA_ROADMAP_ATRIOZ.md`
- Produção de teste: `https://crm.atriozagencia.cloud`
- EasyPanel: projeto `josimaratrioz`, serviço `deskcomm`
- Supabase: projeto `Crm+IA`, referência `fpgjqeetsklyylmfopxc`

### Regra de atualização

O fork Atrioz passa a ser a fonte oficial comercial. O original continua sendo consultado para correções, segurança e boas ideias, mas **nunca deve ser mesclado automaticamente**. Antes de adotar uma atualização do original, comparar os dois repositórios, preservar Compose/EasyPanel e customizações comerciais, testar em branch e só então reimplantar.

Nunca editar diretamente os arquivos dentro do contêiner.

---

## 3. O que foi efetivamente implantado

### GitHub e EasyPanel

- [x] Fork oficial sincronizado e pacote de melhorias versionado.
- [x] Branch `codex/roadmap-fundacoes` enviada ao GitHub.
- [x] Pacote principal integrado até o commit `884e87e`.
- [x] Compose do EasyPanel corrigido no commit `d1f910f`.
- [x] Descoberto que o Compose antigo usava `ghcr.io/melgarafael/deskcommcrm:latest`, isto é, a imagem do autor original.
- [x] Serviço `app` alterado para construir o `Dockerfile` do próprio fork Atrioz.
- [x] Reimplantação executada no EasyPanel.
- [x] Rota `/app/campaigns` passou a aparecer, comprovando que a VPS recebeu o fork personalizado.
- [x] Aplicação inicia e responde em `crm.atriozagencia.cloud`.
- [ ] Produção homologada ponta a ponta.

### Supabase

- [x] Login da CLI corrigido por autenticação de dispositivo.
- [x] Projeto correto identificado e vinculado.
- [x] Confirmado que as tabelas-base necessárias já existiam.
- [x] Evitado `supabase db push` cego, porque o histórico remoto de migrations estava vazio e poderia tentar recriar toda a base.
- [x] Doze migrations novas aplicadas de forma controlada:
  - controle de IA por conversa;
  - campanhas seguras;
  - claims de entrega de campanha;
  - contratos de webhooks;
  - fila Meta CAPI;
  - central de notificações;
  - reordenação de etapas;
  - perfil comercial de contato;
  - convites da equipe;
  - métricas de entrega;
  - templates interativos/enquetes;
  - permissões de campos para IA.
- [x] Objetos principais conferidos no banco, incluindo:
  - `conversations.ai_control_mode`;
  - `contacts.city`;
  - `message_templates.kind`;
  - `message_templates.interactive_config`;
  - `ai_agent_versions.contact_field_access`;
  - funções de métricas, campanhas, notificações, respostas e reordenação.
- [ ] Chave `service_role` correta configurada no EasyPanel.
- [ ] Gravação de auditoria funcionando sem erro de RLS.

### Campanhas

- [x] Página de campanhas visível em produção.
- [x] CSV de homologação criado na Área de Trabalho.
- [x] Preview ao vivo validou corretamente:
  - 1 contato elegível;
  - 1 número duplicado;
  - 1 telefone inválido;
  - 1 contato sem consentimento.
- [x] Normalização, deduplicação, consentimento e bloqueio de registros inválidos confirmados no preview.
- [x] Fluxo previsto no código: criar/atualizar contato e card, texto, espera curta, áudio, cinco minutos completos antes do próximo contato, sem paralelismo.
- [x] Pausa, cancelamento e retomada idempotente previstos.
- [ ] Rascunho real criado com número controlado.
- [ ] Envio real de texto confirmado no WhatsApp.
- [ ] Envio real de áudio após aproximadamente dois segundos.
- [ ] Espera real de cinco minutos antes do segundo destinatário.
- [ ] Pausa, retomada e cancelamento testados ao vivo.
- [ ] Resposta do destinatário cancela/suprime automações futuras.

O CSV falso usado no preview **não deve ser usado para criar rascunho**, pois essa ação pode criar contatos, leads e conversas de teste na base.

---

## 4. Checklist mestre: plano versus realidade

Legenda:

- **Código:** recurso existe no fork e passou pela validação local registrada.
- **Banco:** estrutura nova foi aplicada no Supabase.
- **Ao vivo:** comportamento foi realmente comprovado na produção.

| Módulo | Deveria estar pronto segundo o plano | Código | Banco | Ao vivo | Situação atual / próximo teste |
|---|---|---:|---:|---:|---|
| 4.1 Navegação global | Voltar, breadcrumbs, busca maior e retorno preservando contexto | ✅ | N/A | ⬜ | Percorrer páginas reais e verificar filtros/abas/paginação |
| 4.2 Inbox | Scroll interno, respostas prontas, botão de templates, IA por contato | ✅ | ✅ | ⬜ | Testar muitas mensagens, zoom, celular, receber e enviar WhatsApp |
| 4.3 Radar | Filtros úteis por atendente e conexão | ✅ | ✅ | ⬜ | Testar com dados reais e isolamento por organização |
| 4.4 Conexões | WAHA, reconexão e proteção de envio | preservado | existente | ⬜ | Desconectar/reconectar e testar proteção com número controlado |
| 4.5 Kanban | Criar funis/etapas, editar, ordenar, mover, ganhar/perder | ✅ | ✅ | ⬜ | Criar funil e mover um card real por todas as etapas |
| 4.6 Contatos | Criar/editar dados, tags, campos, observações e voltar | ✅ | ✅ | ⬜ | Criar, editar, atualizar pela IA e testar deduplicação |
| 4.7 Equipe | Convites, papéis, revogação e estados do convite | ✅ | ✅ | ⬜ | Configurar Resend, enviar e aceitar convite real |
| 4.8 Desempenho | Registrada, enviada, entregue, lida, falha e métricas de atendente | ✅ | ✅ | ⬜ | Confirmar ACKs reais do WAHA e números do painel |
| 4.9 Templates | Texto, variáveis copiáveis, preview, botões/listas/enquete e fallback | ✅ | ✅ | ⬜ | Criar pela Inbox e enviar texto e enquete reais |
| 4.10 LGPD | Consentimento, opt-out, supressão e auditoria | reforçado | ✅ | parcial | Revisão operacional/jurídica e teste de exclusão/supressão |
| 4.11 Agentes de IA | Configuração simples, ferramentas, memória, campos permitidos e IA por contato | ✅ | ✅ | ⬜ | Configurar provedor, publicar agente e provar leitura/escrita permitida e negada |
| 4.12 Follow-ups | Modelos simples, fluxo avançado, manual, pausa por handoff e cancelamento por resposta | ✅ | ✅ | ⬜ | Executar fluxo completo com contato controlado |
| 4.13 Memória da IA | Criar, editar, publicar, arquivar, histórico e uso pelo agente | ✅ | ✅ | ⬜ | Criar memória e confirmar que a resposta realmente a utiliza |
| 4.14 Webhooks/3C | HMAC, organização, idempotência, auditoria e criação de lead | ✅ | ✅ | ⬜ | Configurar segredo e enviar o mesmo lead assinado duas vezes |
| 4.15 Configurações | Organização clara, saúde da implantação e permissões; Billing oculto | ✅ | N/A | parcial | Conferir menus e acesso de administrador/gerente/agente |
| 4.16 Notificações | Persistência, sino, in-app, leitura, preferências e e-mail Resend | ✅ | ✅ | ⬜ | Configurar Resend e disparar um evento real |
| 4.17 Campanhas | CSV/Sheets, preview, consentimento, texto+áudio, 5 min, pausa/retomada | ✅ | ✅ | 🟨 | Preview de CSV validado; envio real ainda não feito |
| 4.18 Entrada 3C | Mesmo contrato seguro de webhook para criação/atualização de leads | ✅ | ✅ | ⬜ | Homologar segredo, payload, duplicidade e resultado |
| 4.19 Meta CAPI | Evento de conversão ao ganhar/fechar, fila, hash, consentimento e retries | ✅ | ✅ | ⬜ | Configurar Meta e usar primeiro um código de evento de teste |
| 4.20 Billing | Não oferecer até existir produto comercial e cobrança real | oculto | N/A | ✅ | Continuar oculto nesta fase |
| Visual `/design` | Claro/Escuro/Sistema com Graphite + Electric Blue antes da aplicação global | ✅ | N/A | ⬜ | Obter aprovação visual explícita antes de mudar o sistema inteiro |

### Melhorias segundo minha opiniao

Somente as ideias **1, 2, 5, 6, 7, 10, 11, 12, 13 e 14** do plano foram autorizadas para este ciclo. As ideias **3, 4, 8 e 9** continuam reservadas para conversa futura e não devem ser implementadas sem nova autorização.

---

## 5. Problemas atuais confirmados

### 5.1 Auditoria bloqueada por RLS

Log repetido:

```text
[audit] insert error new row violates row-level security policy for table "api_audit_log"
```

Consequência: ações podem ocorrer, mas a trilha de auditoria não é gravada corretamente. Isso impede homologação de segurança e produção.

Correção planejada:

1. obter novamente a chave `service_role` correta do Supabase sem mostrá-la em chat/documento;
2. abrir EasyPanel → `josimaratrioz` → `deskcomm` → `Ambiente`;
3. substituir somente `SUPABASE_SERVICE_ROLE_KEY`;
4. salvar e reimplantar;
5. abrir os logs do serviço `app`;
6. executar uma ação simples no CRM;
7. confirmar que não surge novo erro de RLS e que `api_audit_log` recebe o registro.

### 5.2 IA ainda sem provedor operacional

Logs confirmados:

```text
No AI_GATEWAY_API_KEY or ANTHROPIC_API_KEY set — ai-response-worker will skip
No OPENAI_API_KEY set — RAG embedding will be unavailable
```

Consequência: a interface de Agentes de IA pode existir, mas o agente não responderá em produção e a recuperação de conhecimento por embeddings ficará indisponível.

### 5.3 Node.js 20 em processo de descontinuação pelo cliente Supabase

É um aviso, não o bloqueio de hoje. Planejar atualização da imagem para Node.js 22, testar build e reimplantar antes de o suporte ser removido.

### 5.4 Telemetria da comunidade ativa

O log informa Sentry comunitário ativo. Antes de produção comercial, decidir entre:

- `SENTRY_DSN=off`; ou
- DSN próprio da Atrioz.

Não deixar telemetria de terceiros sem decisão explícita e política de privacidade compatível.

---

## 6. Ordem exata de retomada amanhã

### Bloco A — tirar o bloqueio da produção

- [ ] Reobter com segurança a `service_role` correta.
- [ ] Corrigir `SUPABASE_SERVICE_ROLE_KEY` no EasyPanel.
- [ ] Reimplantar o Compose.
- [ ] Confirmar aplicação saudável.
- [ ] Confirmar zero novos erros de RLS em `api_audit_log`.
- [ ] Confirmar registro real na auditoria.

### Bloco B — fazer a IA realmente funcionar

- [ ] Escolher/configurar um provedor de IA de teste.
- [ ] Configurar a chave no EasyPanel sem expô-la.
- [ ] Publicar um agente simples.
- [ ] Testar pela página de teste.
- [ ] Testar pelo WhatsApp com número controlado.
- [ ] Testar os três estados por contato: herdar configuração global, forçar IA ativa e pausar IA.
- [ ] Testar atualização pela IA apenas de campos comerciais autorizados.

### Bloco C — homologação operacional

- [ ] Inbox: receber, responder, status e scroll interno.
- [ ] Templates: texto com variável e enquete/fallback.
- [ ] Contatos: editar e deduplicar.
- [ ] Kanban: criar funil/etapas, ordenar e mover card.
- [ ] Follow-up: iniciar manualmente e cancelar após resposta.
- [ ] Campanha controlada: número próprio com consentimento, texto, áudio, 5 minutos, pausa e retomada.
- [ ] Notificações: evento in-app e e-mail Resend.
- [ ] Google Sheets autorizado usando a mesma validação do CSV.

### Bloco D — integrações e fechamento comercial

- [ ] Homologar entrada 3C assinada e idempotente.
- [ ] Homologar Meta CAPI com evento de teste antes de produção.
- [ ] Confirmar que “Fechado/Ganho” gera uma única conversão com `event_id` deduplicável.
- [ ] Confirmar papéis e convites da equipe.
- [ ] Revisar LGPD, opt-out e supressão.

### Bloco E — produto vendável e recuperável

- [ ] Aprovar página de cores `/design`.
- [ ] Só depois aplicar tema global.
- [ ] Configurar/desligar Sentry comunitário.
- [ ] Atualizar para Node.js 22 com testes.
- [ ] Criar backup completo do Supabase e configuração do EasyPanel.
- [ ] Fazer teste real de restauração.
- [ ] Só então declarar a versão pronta para replicação em clientes.

---

## 7. Critério para declarar “pronto”

O CRM só estará pronto para venda/replicação quando todos estes pontos forem verdadeiros:

- [ ] mensagens entram e saem do WhatsApp e aparecem corretamente na Inbox;
- [ ] IA responde com o provedor configurado e pode ser ativada/pausada por contato;
- [ ] IA altera somente dados autorizados e tudo fica auditado;
- [ ] funis, contatos, follow-ups, notificações e templates passam em teste real;
- [ ] campanha controlada respeita consentimento, sequência, intervalo, pausa, retomada e opt-out;
- [ ] entrada 3C e Meta CAPI são seguras, idempotentes e testadas;
- [ ] não há erros recorrentes nos logs;
- [ ] isolamento entre organizações foi provado;
- [ ] backup e restauração foram testados;
- [ ] Hermes, Evolution e o CRM antigo continuam preservados até esta validação terminar.

---

## 8. Estado final desta noite

**Conclusão honesta:** há muito mais do que apenas a página de campanhas. O pacote foi implementado e a estrutura de banco foi instalada. A percepção de que “não apareceu tudo” ocorre porque grande parte das mudanças está dentro de módulos existentes, depende de dados/credenciais reais ou ainda precisa de homologação. A campanha foi o primeiro recurso novo visualmente confirmado em produção.

Não executar disparos reais nem apresentar o ambiente como produção pronta antes de corrigir a chave administrativa e concluir o checklist ao vivo.
