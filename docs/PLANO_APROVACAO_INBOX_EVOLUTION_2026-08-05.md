# Plano de aprovação — Inbox claro e Evolution API

**Status:** aguardando aprovação.  
**Objetivo:** tornar a operação do Inbox compreensível para um usuário comum e substituir a WAHA pela Evolution API para que mensagens recebidas sejam persistidas e disparem a IA de forma confiável.

## Decisão de escopo

Não será recriado o CRM. Contatos, conversas, mensagens, oportunidades, campanhas, IA, LGPD, Supabase e telas continuam sendo a mesma aplicação. A mudança é apenas na central que conecta o CRM ao WhatsApp.

Para esta fase, a proposta é usar **Evolution API com sessão WhatsApp por QR Code**, equivalente ao modo de operação atual da WAHA e ao ambiente que já foi usado nos testes anteriores. A API oficial Cloud da Meta pode entrar como outro provedor no futuro, mas não bloqueia esta entrega.

WAHA será removida da composição ativa ao final da migração. Os dados e o volume dela serão preservados até a Evolution passar nos testes de aceite abaixo, permitindo retorno apenas se necessário durante a implantação.

---

# Frente 1 — Layout e mecânica do Inbox

## Problema atual

O cabeçalho reúne "Agente automático", "IA ativa nesta conversa", "Pegar conversa", "Liberar" e "Transferir" sem explicar a relação entre eles. Hoje, uma conversa pode mostrar IA ativa e ainda assim não receber resposta porque está atribuída a uma pessoa. Isso confunde o operador e pode fazer parecer que a IA falhou.

## Novo desenho proposto

O cabeçalho será organizado em três blocos curtos, com o estado principal visível antes das ações:

```text
Contato e canal
Débora · WhatsApp 7653

Atendimento
[Sem responsável]  [Pegar para mim] [Transferir]
ou
[Responsável: Josimar] [Liberar atendimento] [Transferir]

IA desta conversa
[Ativa — responderá novas mensagens] [Agente: Atendimento IA] [Pausar]
ou
[Aguardando liberação do humano] [Liberar atendimento]
ou
[Pausada] [Ativar IA]
```

### Regras apresentadas na tela

| Ação                    | Resultado claro                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pegar para mim**      | atribui a conversa ao atendente humano; a IA não responde enquanto ela estiver atribuída.                                                      |
| **Liberar atendimento** | remove o responsável humano; se a IA estiver ativa, ela poderá responder a próxima mensagem.                                                   |
| **Transferir**          | atribui a conversa a outro membro; continua sendo atendimento humano.                                                                          |
| **Ativar IA**           | autoriza a IA nesta conversa, mas não inicia follow-up. Se houver humano responsável, o aviso explica que é preciso liberar para a IA assumir. |
| **Pausar IA**           | impede respostas automáticas nesta conversa.                                                                                                   |
| **Escolher agente**     | define qual agente responderá quando a IA puder atuar; não pega nem libera a conversa.                                                         |

### Ajustes visuais incluídos

1. O botão de IA deixa de afirmar apenas “IA ativa” quando há humano responsável. Exibirá: **“IA autorizada — aguardando liberação do humano”**.
2. O responsável e o agente selecionado serão mostrados com nome, não só como “automático/manual”.
3. A conversa selecionada terá borda esquerda e contorno discreto na cor principal configurada pela organização, inclusive após atualização em tempo real.
4. Cada botão terá texto de ajuda ao passar o mouse e uma mensagem de confirmação após a ação.
5. A área lateral continuará recolhível; quando fechada, o botão mostrará “Detalhes do contato”.

## Testes de aceite do Inbox

- Um usuário novo identifica em até uma leitura quem atende a conversa e se a IA responderá ou não.
- Ao clicar em **Pegar para mim**, aparece “Responsável: nome” e a IA fica visualmente “aguardando liberação”.
- Ao clicar em **Liberar atendimento**, o responsável some e, com IA ativa, o estado muda para “responderá novas mensagens”.
- Ao clicar em **Pausar IA**, a IA não gera resposta; ao reativar e liberar, responde a próxima entrada.
- A conversa escolhida permanece claramente destacada na lista.

---

# Frente 2 — Troca de WAHA por Evolution API

## Diagnóstico que motiva a troca

No teste atual, a WAHA conseguiu enviar mensagens, mas parou de entregar mensagens recebidas ao webhook do CRM. A tela de saúde podia continuar exibindo a sessão como conectada, mesmo sem entrada nova. Isso impede Inbox, IA e handoff de funcionarem de verdade.

O critério desta frente não será “o container está ligado”; será: **uma mensagem recebida no telefone aparece no Inbox e dispara a automação correta em poucos segundos**.

## Arquitetura final

```text
WhatsApp
   ↓ eventos da Evolution
Evolution API
   ↓ webhook assinado
CRM: normalizador Evolution
   ↓
Supabase: contatos + conversas + mensagens + eventos
   ↓
Inbox / IA / notificações / campanhas
   ↓
Evolution API envia a resposta
```

O CRM passa a trabalhar com uma interface interna de canal. Assim, regras de negócio não conhecem WAHA nem Evolution diretamente:

- enviar texto, mídia, áudio, enquete e mensagem para grupo;
- consultar estado da sessão e gerar QR Code;
- receber e validar webhook;
- normalizar mensagem recebida, enviada pelo celular, confirmação de entrega, mídia e voto de enquete;
- resolver número, grupo e ID externo de mensagem;
- registrar erro e estado real de sincronização.

## Etapas de execução

### E1 — Base e infraestrutura Evolution

1. Adicionar os serviços necessários da Evolution ao EasyPanel, com banco/Redis/volume próprios quando exigidos pela versão escolhida.
2. Criar variáveis separadas e seguras: URL interna, chave de API e segredo do webhook.
3. Criar a instância do WhatsApp pelo CRM e exibir QR Code, nome, telefone e estado de conexão.
4. Não expor painel administrativo da Evolution publicamente.

**Entrega verificável:** uma conexão criada pelo CRM alcança o estado conectado e mostra o QR Code quando necessário.

### E2 — Adaptador de canal e dados

1. Criar o adaptador `Evolution` e uma camada interna de canal compartilhada.
2. Alterar `channel_sessions` para identificar o provedor e o identificador externo da sessão, sem apagar sessões ou histórico atuais.
3. Migrar os pontos que hoje dependem diretamente de `waha_session_name` para o identificador neutro da sessão.
4. Manter deduplicação por ID externo, normalização E.164, associação de contato/conversa e auditoria de eventos.

**Entrega verificável:** uma mensagem de teste cria ou atualiza exatamente um contato, uma conversa e uma mensagem — sem duplicidade.

### E3 — Recebimento confiável e sincronização

1. Criar webhook Evolution com autenticação por segredo, validação de organização e gravação do evento bruto para diagnóstico.
2. Processar mensagens recebidas, mensagens enviadas pelo celular, mensagens enviadas pelo CRM, confirmações, reações, mídias e votos de enquete.
3. Atualizar a conversa em tempo real no Inbox e executar o despachante de IA apenas depois da persistência da mensagem.
4. Criar saúde de conexão baseada em eventos: **conectada e recebendo**, **conectada mas sem receber**, **desconectada** e **erro de webhook**.
5. Incluir recuperação controlada de eventos pendentes quando a Evolution oferecer consulta de histórico/eventos; nunca duplicar mensagens já persistidas.

**Entrega verificável:** dez mensagens alternadas entre celular e CRM, incluindo uma resposta recebida, aparecem na mesma conversa, em ordem, sem F5 e sem duplicidade.

### E4 — Envio e recursos operacionais

1. Migrar envio manual do Inbox, envio iniciado por Contatos, resposta da IA, follow-ups e campanhas.
2. Migrar mídia, áudio, enquetes, mensagens de grupo de gestores e envio por múltiplos números.
3. Migrar verificação de disponibilidade de WhatsApp, se a capacidade estiver disponível na versão da Evolution usada; caso não esteja, o CRM informará claramente que não foi possível verificar antes do envio.
4. Migrar estados de envio/erro para a tela de desempenho e para o histórico da conversa.

**Entrega verificável:** CRM envia texto, IA envia resposta, campanha de teste envia para um contato autorizado e uma enquete recebe voto no Inbox.

### E4.1 — Campanhas por CSV (obrigatória)

As campanhas não serão tratadas como um detalhe do Inbox. Elas são um fluxo próprio e precisam usar a Evolution diretamente para cada envio da lista CSV.

1. A importação CSV, a normalização de telefone, deduplicação, tags, origem e a prévia de elegíveis continuam no CRM.
2. O worker de campanha deixa de usar os métodos da WAHA para verificar e enviar. Ele passa a usar o adaptador Evolution para:
   - escolher a conexão Evolution configurada para a campanha;
   - enviar cada mensagem ao número normalizado do CSV;
   - registrar o ID externo retornado pela Evolution;
   - registrar enviado, entregue, lido, falhou e motivo da falha quando o provedor disponibilizar esses eventos;
   - respeitar intervalo, limite por número, pausa, opt-out/LGPD e distribuição entre conexões.
3. As respostas recebidas de contatos de uma campanha devem retornar à mesma conversa no Inbox, criar/atualizar o contato e manter a origem da campanha no histórico.
4. A IA só responde se a configuração da campanha e a regra da conversa permitirem; disparo em massa não pode assumir atendimento humano sem essa regra explícita.
5. Antes de qualquer campanha real, haverá uma campanha de teste com uma lista CSV interna, um número de destino autorizado e uma única conexão Evolution.

**Aceite específico de campanha:** importar CSV de teste → visualizar elegíveis → enviar → mensagem chegar no celular → resposta aparecer no Inbox → status e origem ficarem registrados sem duplicar contato.

### E5 — Corte e limpeza da WAHA

1. Rodar o roteiro de aceite completo com um número real de teste e a IA liberada em uma conversa específica.
2. Tornar Evolution o provedor padrão para novas conexões.
3. Retirar dependências WAHA da aplicação, workers, healthcheck, variáveis e composição EasyPanel.
4. Manter backup do volume e da configuração WAHA antes de removê-la definitivamente.
5. Atualizar documentação de implantação e operação da equipe.

**Entrega verificável:** não há serviço, variável, tela ou worker necessário apontando para WAHA; o CRM continua passando build, testes e teste real de WhatsApp.

## Roteiro obrigatório de aceite final

1. Conectar uma instância Evolution via QR Code.
2. Mensagem recebida pelo celular aparece no Inbox em até 15 segundos, sem recarregar a página.
3. Mensagem enviada pelo CRM aparece no celular e no próprio histórico do Inbox.
4. Mensagem enviada pelo celular conectado aparece no CRM.
5. Ativar IA somente para uma conversa sem responsável humano; enviar mensagem; confirmar resposta da IA.
6. Pegar a mesma conversa para um humano; enviar mensagem; confirmar que a IA não responde.
7. Liberar a conversa; enviar nova mensagem; confirmar resposta da IA.
8. Enviar áudio, imagem e enquete; confirmar que o Inbox registra os três e registra o voto.
9. Criar contato pelo CRM e iniciar conversa escolhendo a conexão Evolution.
10. Desconectar e reconectar a sessão; confirmar que a Saúde do sistema muda para o estado correto e que o QR Code reaparece.

## Limites desta aprovação

- Não há alteração de dados comerciais, exclusão de contatos ou disparo em massa real durante a implementação.
- Campanhas e IA usarão somente contatos de teste até os dez itens de aceite passarem.
- A troca para API oficial Cloud da Meta não faz parte desta entrega; ela poderá usar a mesma camada de canal em uma fase posterior.

## Aprovação solicitada

Aprovar este plano significa autorizar:

1. A implementação do novo layout e da mecânica explicada do Inbox.
2. A substituição da WAHA pela Evolution API em todas as rotas necessárias.
3. O uso de um número de teste para o roteiro de aceite.
4. A remoção da WAHA somente após todos os testes de aceite passarem.
