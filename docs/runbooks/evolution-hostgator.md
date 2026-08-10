---
title: Runbook — Evolution API em produção (VPS HostGator)
status: canônico
last_review: 2026-08-10
---

# Evolution API em produção

Este é o runbook operacional do transporte WhatsApp do Atrioz CRM. A aplicação usa exclusivamente a Evolution API; não existe fallback para outro conector.

## 1. Pré-requisitos

- VPS com Docker Engine e Compose v2.
- domínio HTTPS estável para o CRM;
- `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_SECRET` e `EVOLUTION_DB_PASSWORD` fortes e diferentes;
- backup externo criptografado do volume e do Postgres da Evolution.

Use a imagem fixada no repositório (`evoapicloud/evolution-api:v2.3.7` por padrão). Atualizações de versão devem ser explícitas, testadas e acompanhadas por backup.

## 2. Variáveis obrigatórias

```env
EVOLUTION_API_BASE_URL=http://evolution:8080
EVOLUTION_SERVER_URL=https://evo.seudominio.com
EVOLUTION_API_KEY=<openssl-rand-hex-32>
EVOLUTION_WEBHOOK_SECRET=<outro-openssl-rand-hex-32>
EVOLUTION_DB_NAME=evolution
EVOLUTION_DB_USER=evolution
EVOLUTION_DB_PASSWORD=<senha-exclusiva>
NEXT_PUBLIC_APP_URL=https://crm.seudominio.com
```

Nunca exponha a chave da Evolution em variáveis `NEXT_PUBLIC_*`, logs ou capturas de tela.

## 3. Subida e verificação

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs evolution evolution-postgres --tail 200
```

O Postgres da Evolution deve ficar saudável antes da API. No CRM, abra **Conexões**, crie a instância, escaneie o QR e espere o estado `WORKING`.

## 4. Contrato de webhook

Cada conexão possui token opaco próprio e recebe eventos em:

```text
https://crm.seudominio.com/api/v1/webhooks/evolution/<token>
```

Eventos mínimos:

- `MESSAGES_UPSERT`: mensagens recebidas e enviadas;
- `MESSAGES_UPDATE`: entregue, lida e áudio reproduzido;
- atualizações de conexão/QR necessárias ao painel.

Teste obrigatório após conectar:

1. celular envia texto ao número conectado;
2. mensagem aparece no Inbox sem F5;
3. CRM responde e a mensagem chega ao celular;
4. entregue/lida progride sem regredir;
5. áudio recebido e enviado toca no CRM;
6. mensagem inbound com IA autorizada gera resposta.

## 5. Saúde e diagnóstico

Ordem de diagnóstico:

1. conexão aparece `WORKING` no CRM;
2. `last_inbound_event_at` avança ao receber mensagem;
3. histórico seguro de webhook registra o evento;
4. tabelas `contacts`, `conversations` e `messages` recebem linhas da mesma organização;
5. dispatcher/worker da IA recebe o evento inbound;
6. resposta é gravada e enviada pela Evolution.

Não considere uma instância saudável somente porque o QR está conectado. Uma mensagem real em cada direção é a prova mínima.

## 6. Backup e restauração

Faça backup diário do Postgres e do volume da Evolution, com retenção externa. Antes de atualizar:

```bash
docker compose -f docker-compose.prod.yml exec -T evolution-postgres \
  pg_dump -U "$EVOLUTION_DB_USER" "$EVOLUTION_DB_NAME" > evolution-before-upgrade.sql
```

Valide o arquivo, copie-o para armazenamento externo e só então atualize a imagem. Após restaurar, repita todos os seis testes do contrato de webhook.

## 7. Incidentes

- **401:** chave do CRM e do container divergem; alinhe e reinicie.
- **QR não aparece:** confira logs, estado da instância e acesso do CRM à URL interna.
- **Envia, mas não recebe:** confira configuração do webhook, token da sessão e `MESSAGES_UPSERT`.
- **Recibos não mudam:** confira `MESSAGES_UPDATE` e IDs externos persistidos.
- **Mídia não toca:** confira obtenção do base64 pela Evolution, MIME suportado e persistência no Storage.
- **IA não responde:** primeiro prove que a mensagem inbound chegou ao banco; depois audite autorização da IA, dispatcher, credencial e worker.

Não apague a instância nem o volume como primeira tentativa. Preserve logs, IDs externos e timestamps para diagnóstico.
