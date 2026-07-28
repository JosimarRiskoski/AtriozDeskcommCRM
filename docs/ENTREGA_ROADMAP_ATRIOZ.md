# Entrega do roadmap Atrioz

Este documento é o ponto de retomada para publicar e homologar as melhorias feitas no fork `JosimarRiskoski/AtriozDeskcommCRM`.

## Estado validado localmente

- Branch: `codex/roadmap-fundacoes`
- Verificação de tipos: aprovada.
- Testes automatizados dos módulos alterados: aprovados.
- Build de produção do Next.js: aprovado.
- O tema Atrioz continua isolado em `/design`; não foi aplicado globalmente sem aprovação visual.
- Nenhuma alteração foi feita diretamente dentro dos containers da VPS.

## Melhorias incluídas

- botão de voltar e preservação de contexto nas telas de detalhes;
- Inbox com altura correta, rolagem interna, respostas rápidas e controle da IA por contato;
- contato editável e acionamento manual de follow-up;
- follow-ups com modelos prontos, edição simples e modo avançado opcional;
- campanhas seguras por CSV com criação prévia de contato, negócio e conversa;
- sequência texto, espera curta, áudio e intervalo sequencial entre contatos;
- pausa, retomada, cancelamento, supressão, consentimento, deduplicação e retomada idempotente;
- entrada autenticada de leads da 3C;
- fila auditável de conversões da Meta;
- notificações funcionais;
- administração visual de funis e etapas;
- atualização de dados comerciais do contato pela IA, limitada a campos autorizados;
- Radar explicado e filtrável;
- Conexões com diagnóstico de prontidão e explicação da proteção de envio;
- busca do topo ampliada e Configurações agrupadas por finalidade.
- busca global real por contatos, conversas, negócios, arquivos e atalhos autorizados;
- histórico de alterações traduzido, com detalhes técnicos recolhidos;
- central de saúde do sistema por organização;
- checklist de implantação que combina verificações automáticas e confirmações manuais;
- Conexões com última mensagem realmente recebida e enviada por número.
- convites de equipe persistidos, com estados, reenvio e cancelamento;
- Desempenho com período selecionável, origem dos cálculos e separação entre mensagens registradas, entregues, lidas e falhas;
- Memória da IA com criação, histórico, edição, arquivamento, reativação e remoção auditada.

## Etapa 1 — aplicar o banco

Antes de publicar a aplicação, aplicar em ordem todas as migrations ainda ausentes no Supabase do ambiente:

1. `20260727213000_0074_conversation_ai_control.sql`
2. `20260727220000_0085_safe_outreach_campaigns.sql`
3. `20260727221000_0086_campaign_delivery_claims.sql`
4. `20260727222000_0087_webhook_source_contracts.sql`
5. `20260727223000_0088_meta_capi_queue.sql`
6. `20260727224000_0089_notification_center.sql`
7. `20260727225000_0090_pipeline_stage_reorder.sql`
8. `20260727230000_0091_contact_commercial_profile.sql`
9. `20260727231000_0092_team_invitations.sql`
10. `20260727232000_0093_metrics_message_delivery.sql`

Use o mecanismo normal de migrations do projeto. Não copie trechos isolados nem pule arquivos, porque as APIs e as telas dependem desse conjunto.

## Etapa 2 — enviar a branch ao GitHub

Esta etapa exige a autenticação do proprietário do fork.

```powershell
cd C:\Projetos\AtriozDeskcommCRM
git status
git push -u origin codex/roadmap-fundacoes
```

Depois, revisar a diferença contra `main` e integrar somente após a aplicação das migrations no ambiente de homologação.

## Etapa 3 — reimplantar no EasyPanel

1. Abrir o projeto `josimaratrioz`.
2. Abrir o serviço Compose `deskcomm`.
3. Confirmar que a fonte continua sendo o fork da Atrioz.
4. Selecionar a branch integrada ou, temporariamente, `codex/roadmap-fundacoes` para homologação.
5. Implantar.
6. Acompanhar `app`, `worker`, `scheduler`, `waha`, `srh` e `redis` até todos estabilizarem.
7. Não remover Hermes, Evolution ou o CRM anterior nesta fase.

## Etapa 4 — configuração após a publicação

- abrir cada agente existente, habilitar as novas ferramentas comerciais autorizadas e publicar uma nova versão;
- configurar a chave HMAC da origem 3C;
- configurar Meta Dataset/Pixel e token somente no servidor;
- conferir o cron do worker de campanhas, follow-ups, notificações e conversões Meta;
- confirmar que segredos não aparecem novamente na interface;
- manter campanhas desativadas até concluir o teste com uma lista controlada.

## Etapa 5 — homologação obrigatória

Antes de iniciar, abrir **Configurações > Implantação do cliente**. Os itens automáticos precisam estar concluídos. Marcar backup/restauração e teste ponta a ponta somente depois de comprová-los.

- [ ] login, convite e organização correta;
- [ ] WhatsApp conecta e reconecta;
- [ ] mensagem recebida aparece no Inbox;
- [ ] mensagem enviada chega ao celular e atualiza o status;
- [ ] contato pode ser criado, editado e deduplicado;
- [ ] negócio muda de etapa pelo humano e pela IA;
- [ ] IA pode ser pausada globalmente, ativada somente para um contato e devolvida ao atendimento normal;
- [ ] erro do provedor de IA não é enviado ao cliente;
- [ ] resposta rápida substitui as variáveis corretamente;
- [ ] mensagem registrada, entregue, lida e falha aparecem separadamente em Desempenho;
- [ ] aprendizado da IA pode ser criado, editado, arquivado, reativado e removido;
- [ ] follow-up manual inicia e para quando o contato responde;
- [ ] campanha cria contato, negócio e conversa antes do primeiro envio;
- [ ] campanha envia texto, espera, envia áudio e aguarda o intervalo antes do próximo contato;
- [ ] pausa e retomada da campanha não duplicam mensagens;
- [ ] notificação crítica abre o item correto;
- [ ] lead da 3C entra uma única vez na organização correta;
- [ ] negócio ganho gera uma única conversão auditada na Meta;
- [ ] backup completo foi criado e uma restauração foi ensaiada;
- [ ] página `/design` foi aprovada antes de qualquer troca visual global.

## Regra de atualização do projeto original

O repositório original é apenas `upstream`. Antes de incorporar uma atualização:

1. comparar o original com o fork;
2. revisar conflitos em migrations, Compose, autenticação, WAHA, campanhas, IA e multi-organização;
3. integrar em uma branch separada;
4. executar testes e build;
5. nunca fazer merge automático nem editar o container em produção.
