# Plano completo — Inbox, recibos, áudio e oportunidade

**Data:** 10/08/2026
**Status:** banco e deploy concluídos; validação real parcialmente aprovada
**Canal WhatsApp definido:** Evolution API exclusivamente

## 1. Objetivo

Corrigir o fluxo operacional do Inbox para que:

1. abrir uma conversa marque as mensagens recebidas como lidas;
2. mensagens enviadas mostrem corretamente enviada, entregue e lida;
3. áudios recebidos e enviados possam ser reproduzidos no CRM;
4. a aplicação use somente Evolution API, sem fallback ou dependência operacional do WAHA;
5. o botão `Lead` vire `Criar oportunidade` e funcione diretamente no Inbox;
6. o botão de respostas rápidas não seja confundido com o botão de anexar.

## 2. Decisões fechadas

### 2.1 Evolution é o único conector

- Não manter compatibilidade, fallback ou recuperação por WAHA.
- Mensagens, mídia, áudio, campanhas, contatos, grupos, recibos e leitura usam Evolution.
- Remover código, configuração, documentação e testes operacionais do WAHA após o inventário de referências.
- Não religar WAHA como rollback. Um rollback reverte apenas a versão da aplicação, preservando a Evolution.

### 2.2 Estados visuais das mensagens

- Um traço: enviada.
- Dois traços cinza: entregue.
- Dois traços azuis: lida.
- Áudio reproduzido é tratado como nível equivalente a lido, quando a Evolution informar esse estado.
- Um estado nunca pode regredir. Por exemplo: `lida` não volta para `entregue`.

### 2.3 Abrir conversa marca como lida

Ao selecionar uma conversa no Inbox, o CRM deve:

1. zerar o contador de não lidas imediatamente na interface;
2. persistir a leitura no banco;
3. enviar à Evolution o recibo das mensagens inbound ainda não lidas;
4. atualizar a lista sem F5;
5. não repetir recibos já enviados.

### 2.4 Oportunidade no Inbox

- Renomear `Lead` para `Criar oportunidade`.
- Vincular automaticamente a oportunidade ao contato e à conversa selecionada.
- Se já existir oportunidade aberta, mostrar `Abrir oportunidade` em vez de criar duplicidade.

## 3. Diagnóstico confirmado

### 3.1 Recibos existem visualmente, mas não fecham o fluxo

O componente de mensagem já renderiza `enviada`, `entregue` e `lida`, porém o ambiente publicado mantém mensagens em `Enviada` mesmo após entrega ou leitura no celular.

Pontos encontrados:

- a Evolution é configurada para emitir eventos de atualização;
- o ingest recebe `MESSAGES_UPDATE` e `SEND_MESSAGE_UPDATE`;
- o update de ACK não verifica erro nem quantas linhas foram atualizadas;
- divergências entre o ID retornado no envio e o ID do evento podem falhar silenciosamente;
- selecionar uma conversa atualmente apenas altera `selectedId`;
- não existe uma ação própria de `marcar como lida` na seleção.

### 3.2 Áudio falha no ambiente publicado

Na conversa verificada no CRM, o áudio foi substituído por `Mídia indisponível`.

Pontos encontrados:

- o player visual existe;
- o worker possui caminho específico para mídia Evolution;
- a rota consumida pelo navegador ainda tenta fallback do WAHA quando a mídia não está no Storage;
- se a persistência atrasar ou falhar, a reprodução cai nesse fallback incompatível;
- precisamos observar também se o worker de persistência está consumindo e concluindo os eventos.

### 3.3 Botão `Lead` não possui ação

O botão está presente na lateral do Inbox, mas não possui `onClick`, diálogo ou navegação vinculada.

### 3.4 Ícones ambíguos no compositor

O botão de anexar e o botão de respostas rápidas usam símbolos visualmente parecidos. O segundo botão usa `+`, embora sua ação seja abrir respostas rápidas.

## 4. Fases de execução

## Fase 1 — Instrumentação e contrato da Evolution

### Alterações

1. Registrar de forma segura os eventos:
   - `MESSAGES_UPSERT`;
   - `MESSAGES_UPDATE`;
   - `SEND_MESSAGE_UPDATE`;
   - eventos relacionados a mídia.
2. Guardar somente identificadores, tipo, status, horário, instância e resultado; nunca registrar texto completo, telefone integral ou base64.
3. Registrar quantidade de linhas afetadas ao atualizar recibos.
4. Gerar alerta técnico quando um evento de ACK atualizar zero mensagens.
5. Ler a configuração efetiva da instância e garantir que os eventos necessários estejam inscritos.
6. Confirmar a versão instalada da Evolution e fixar a imagem em uma versão explícita, sem `latest`.

### Entrega verificável

Um evento real de entrega/leitura pode ser rastreado desde a Evolution até a linha exata da mensagem no banco.

## Fase 2 — Enviada, entregue e lida

### Alterações

1. Normalizar estados textuais e numéricos da Evolution:
   - pendente;
   - confirmação do servidor;
   - entregue;
   - lida;
   - reproduzida.
2. Criar um resolvedor de identidade da mensagem para comparar:
   - ID retornado no envio;
   - `key.id` recebido no webhook;
   - possíveis formas completas ou normalizadas.
3. Atualizar `ack`, `status`, `delivered_at` e `read_at`.
4. Só aceitar progressão de estado.
5. Tratar evento duplicado e evento fora de ordem com idempotência.
6. Mostrar tooltip nos indicadores: `Enviada`, `Entregue` e `Lida`.
7. Diferenciar falha de envio de ausência temporária de recibo.

### Entrega verificável

Uma mensagem real progride na interface sem F5 e sem regressão de estado.

## Fase 3 — Marcar conversa como lida ao abrir

### Alterações

1. Criar endpoint/RPC transacional de leitura da conversa.
2. Validar organização, usuário e acesso à conversa.
3. Marcar somente mensagens inbound ainda não lidas.
4. Zerar `unread_count_for_assignee`.
5. Implementar atualização otimista no Inbox com restauração em caso de erro.
6. Enviar à Evolution as chaves das mensagens que precisam de recibo.
7. Evitar novas chamadas quando a conversa já estiver lida.
8. Manter o contador correto em Fila, Minhas, Todas e filtro `Apenas não lidos`.

### Entrega verificável

Uma conversa com contador sai da lista de não lidas imediatamente após ser aberta e permanece lida depois de recarregar a página.

## Fase 4 — Áudio somente pela Evolution

### Alterações

1. Remover `fetchWahaMedia` da rota de mídia.
2. Remover o fallback WAHA e seus comentários.
3. Fazer a ingestão Evolution guardar os dados necessários para recuperar a mídia.
4. Priorizar mídia já persistida no bucket privado `whatsapp-media`.
5. Quando ainda não persistida, usar apenas o método oficial da Evolution para recuperar o arquivo.
6. Corrigir o worker para:
   - consumir o evento;
   - baixar a mídia;
   - validar tamanho e MIME;
   - persistir no Storage;
   - atualizar `media_storage_path`, tamanho e estado;
   - repetir com backoff em falha transitória;
   - registrar falha permanente de forma visível.
7. Corrigir a resposta da rota de mídia:
   - `Content-Type` correto;
   - cache privado;
   - suporte necessário para duração, busca e retomada;
   - erro em português com ação `Tentar novamente`.
8. Validar OGG/Opus, WebM/Opus, MP3 e os formatos efetivamente entregues pela Evolution.
9. Preservar áudio depois de atualização da página ou reinício da aplicação.

### Entrega verificável

Áudios inbound e outbound reais tocam, pausam, avançam e mudam de velocidade no CRM.

## Fase 5 — Remoção definitiva do WAHA

### Inventário obrigatório

Revisar e remover ou substituir referências em:

- clientes e ingest do conector;
- workers;
- rotas de mensagens e mídia;
- campanhas;
- conexões e healthcheck;
- onboarding e QR Code;
- variáveis de ambiente;
- Docker Compose e EasyPanel;
- documentação de instalação e deploy;
- testes e mocks legados;
- textos exibidos ao usuário.

### Regra de conclusão

Não basta remover o container. A busca final não pode encontrar dependência operacional de `WAHA_*`, cliente WAHA, webhook WAHA ou fallback de mídia WAHA.

Referências históricas em documentos antigos podem ser mantidas apenas quando claramente marcadas como histórico e não forem usadas para instalação atual.

### Entrega verificável

O CRM compila, testa, envia e recebe mensagens, processa campanhas, mídia, áudio, leitura e IA sem serviço ou variável WAHA.

## Fase 6 — Criar oportunidade pelo Inbox

### Interface

1. Renomear o botão `Lead` para `Criar oportunidade`.
2. Usar ícone comercial claro, diferente de contato, tag e caso humano.
3. Abrir diálogo sem sair do Inbox.
4. Preencher automaticamente:
   - `contact_id`;
   - `conversation_id`, quando o modelo permitir;
   - nome e telefone para exibição;
   - origem principal e histórico de origem;
   - pipeline principal;
   - primeira etapa ativa do pipeline.
5. Permitir escolher:
   - título;
   - pipeline;
   - etapa;
   - responsável;
   - valor previsto;
   - próxima ação;
   - observação interna.

### Prevenção de duplicidade

1. Consultar oportunidades abertas do contato antes de criar.
2. Quando houver uma:
   - mostrar `Abrir oportunidade`;
   - abrir o detalhe existente;
   - não criar outro cartão silenciosamente.
3. Quando houver mais de uma, abrir uma lista para escolha.

### Após salvar

- Mostrar confirmação com nome do pipeline e etapa.
- Atualizar a lateral do Inbox sem F5.
- Oferecer `Ver no Kanban`.
- Registrar a criação na timeline e auditoria.

### Entrega verificável

Uma oportunidade criada no Inbox aparece imediatamente na etapa correta do Kanban e continua vinculada ao mesmo contato.

## Fase 7 — Ícone de respostas rápidas

### Alterações

1. Manter o botão de anexar com ícone exclusivo de anexo/documento.
2. Trocar o `+` de respostas rápidas por ícone de mensagem pronta, texto ou atalho.
3. Alterar tooltip para `Respostas rápidas`.
4. Manter `aria-label` igual ao significado visual.
5. Validar tema claro, escuro, hover, foco por teclado e notebook.

### Entrega verificável

Um usuário distingue anexar arquivo de abrir respostas rápidas sem depender do tooltip.

## Fase 8 — Testes e implantação

### Testes automatizados

1. Mapeamento de todos os status Evolution.
2. ACK com ID completo e normalizado.
3. ACK que não encontra mensagem gera erro observável.
4. Evento duplicado não repete efeito.
5. Evento atrasado não regride status.
6. Marcar conversa como lida respeita organização e permissão.
7. Mídia Evolution válida é persistida.
8. Mídia inválida, grande ou expirada falha com segurança.
9. Criação de oportunidade vinculada ao contato.
10. Bloqueio de oportunidade duplicada.

### Testes reais obrigatórios

1. Receber mensagem e confirmar contador.
2. Abrir conversa e confirmar contador zerado sem F5.
3. Recarregar página e confirmar que continua lida.
4. Enviar texto e observar enviada, entregue e lida.
5. Confirmar que privacidade do WhatsApp pode impedir o recibo azul, sem transformar isso em erro do CRM.
6. Receber e tocar áudio.
7. Gravar e enviar áudio pelo CRM; tocar no celular e depois novamente no CRM.
8. Reiniciar/reimplantar e confirmar que os áudios continuam disponíveis.
9. Criar oportunidade pelo Inbox e confirmar cartão no Kanban.
10. Confirmar que contato com oportunidade existente mostra `Abrir oportunidade`.
11. Validar ícones de anexo e respostas rápidas em notebook e celular.
12. Executar uma campanha controlada com texto e áudio usando somente Evolution.

### Ordem de implantação

1. Fazer backup e registrar versão atual da aplicação e da Evolution.
2. Aplicar migrations necessárias.
3. Publicar aplicação e workers.
4. Confirmar healthchecks.
5. Executar testes controlados com números autorizados.
6. Só concluir após evidência nos dois sentidos: celular para CRM e CRM para celular.

## 5. Arquivos inicialmente envolvidos

- `components/inbox/MessageBubble.tsx`
- `components/inbox/InboxLayout.tsx`
- `components/inbox/CRMSidePanel.tsx`
- `components/inbox/Composer.tsx`
- `components/inbox/media/AudioPlayer.tsx`
- `app/api/v1/messages/[id]/media/route.ts`
- `app/api/v1/leads/route.ts`
- `lib/evolution/client.ts`
- `lib/evolution/ingest.ts`
- `workers/media-persist-worker.ts`
- configurações de aplicação, workers, Docker Compose e EasyPanel

Esta lista será ampliada pelo inventário da Fase 5 antes de qualquer exclusão.

## 6. Critério final de aceite

O plano só estará concluído quando:

- o Inbox marcar conversa como lida ao abrir;
- os indicadores refletirem o melhor estado realmente informado pela Evolution;
- áudio enviado e recebido funcionar de ponta a ponta;
- nenhuma função operacional depender de WAHA;
- `Criar oportunidade` funcionar no Inbox sem duplicar cartões;
- respostas rápidas e anexo possuírem ícones inequívocos;
- build, testes e validação real no ambiente publicado forem aprovados.

## 7. Andamento da execução em 10/08/2026

### Concluído no código

- Fases 1 a 7 implementadas.
- Leitura da conversa transacional, atualização otimista e restauração em erro.
- Recibos Evolution monotônicos, inclusive entregue, lida e reproduzida.
- Áudio Evolution-only, Storage primeiro, recuperação oficial e suporte a byte range.
- Botão `Criar oportunidade`, vínculo com contato/conversa e prevenção de nova duplicidade.
- Ícones distintos para anexo e respostas rápidas.
- Código, rotas, workers, configuração, instalação e documentação operacional ativos sem WAHA.
- Baseline e tipos do banco atualizados.

### Portões locais aprovados

- Testes unitários: **169 arquivos e 1.192 testes aprovados**.
- ESLint: **0 erros**; permanecem avisos preexistentes não bloqueantes.
- TypeScript: aprovado com `tsc --noEmit`.
- Build de produção Next.js: aprovado.
- Busca operacional por `WAHA`, clientes, webhooks e variáveis legadas: zero ocorrências nas áreas ativas auditadas.

### Banco, deploy e validações publicadas concluídas

1. As migrations `0122`, `0123` e `0124` foram aplicadas no banco publicado, na ordem prevista.
2. Aplicação e workers foram publicados pelo EasyPanel no commit `7539d401`.
3. O deploy terminou com sucesso em 10/08/2026 e recriou aplicação, worker e Evolution.
4. O endpoint público de saúde respondeu HTTP 200, com Supabase, Redis e Evolution em estado `ok`.
5. A conexão `WhatsApp 7653` aparece conectada e disponível para Inbox, atendimento humano, IA e follow-ups.
6. Ao abrir uma conversa com mensagens não lidas, o contador desapareceu sem F5 e a conversa permaneceu visualmente selecionada.
7. O compositor publicado apresenta ações distintas para `Anexar` e `Respostas rápidas`.
8. O botão `Criar oportunidade` abriu o formulário já vinculado ao contato e à conversa, sem criar dados durante a inspeção.
9. Um áudio recebido carregou pela nova rota de mídia Evolution com duração reconhecida, `readyState = 4` e sem erro de reprodução.
10. Nenhum erro ou aviso foi observado no console do navegador durante essas validações.

### Pendente antes do aceite final

1. Enviar uma nova mensagem real após este deploy e confirmar progressão `enviada → entregue → lida` informada pela Evolution.
2. Gravar/enviar um áudio pelo CRM, reproduzi-lo no celular e confirmar o estado reproduzido no CRM.
3. Criar uma oportunidade de teste, confirmar o cartão no Kanban e tentar uma segunda criação para provar o bloqueio de duplicidade no banco publicado.
4. Executar uma campanha controlada com texto e áudio usando somente Evolution.
5. Remover no host Docker o contêiner órfão legado `josimaratrioz_deskcomm-waha-1`; ele não integra mais o Compose nem o código ativo, mas ainda existe fisicamente no servidor.
6. Executar o teste de baseline/banco efêmero quando o Docker Desktop estiver disponível; nesta execução o daemon local estava desligado.

O plano não deve ser marcado como concluído apenas porque o build passou. O aceite final continua condicionado ao banco publicado e aos testes reais descritos acima.
