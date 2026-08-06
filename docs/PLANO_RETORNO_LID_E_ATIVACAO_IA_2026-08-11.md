# Plano de retorno — recebimento LID e ativação da IA

**Retomada prevista:** 11/08/2026 (terça-feira)  
**Objetivo:** corrigir os dois defeitos confirmados no teste real e implantar a chave geral da IA, sem refazer o CRM, trocar novamente a Evolution ou alterar campanhas.

## Diagnóstico já confirmado

### 1. Débora: CRM envia, mas não recebe as respostas dela

- O envio do CRM para o WhatsApp da Débora funciona.
- Mensagens de outros contatos chegam normalmente ao Inbox.
- Portanto, a conexão Evolution e o webhook geral estão operando.
- O candidato principal é uma identidade WhatsApp `@lid`: o código atual guarda mensagens `@lid` como pendentes e tenta resolvê-las pelo conector WAHA, que não é mais o transporte ativo.
- Isso ainda precisa de uma prova no evento real da Débora antes de qualquer alteração: não será tratado como certeza sem o payload/log correspondente.

### 2. Chico: “Devolver para IA” não ativa a IA

- A conversa está com **Agente: Sophia** e **Responsável: sem responsável**.
- Ao escolher **Devolver para IA**, a tela permaneceu em **IA pausada nesta conversa**.
- Logo, o estado `force_active` não foi refletido após a ação. O defeito pode estar no salvamento da rota, na permissão/regra do banco ou na atualização visual; a causa será medida antes do ajuste.

## Regra de uso que o sistema deve deixar verdadeira

Para a IA responder uma conversa individual:

1. A conversa deve estar aberta e receber uma mensagem nova.
2. Deve haver um agente aplicável, por exemplo `Sophia`.
3. A conversa não pode estar atribuída a uma pessoa.
4. O controle da IA deve estar em `IA responderá novas mensagens` (modo individual ativo) ou numa regra geral realmente habilitada.
5. O worker da IA precisa estar saudável para consumir o evento e enviar a resposta.

`Pegar para mim` e `Transferir` são ações humanas. Elas não ativam a IA.  
`Liberar` só é usado quando existir uma pessoa responsável.  
`Devolver para IA` deve salvar o modo individual ativo e transformar o rótulo da tela em `IA responderá novas mensagens`.

## Fase 1 — fotografia e proteção antes de mexer

1. Confirmar no EasyPanel que `app`, `worker`, `scheduler` e `evolution` estão saudáveis.
2. Salvar os logs recentes de `app`, `worker` e `evolution`, sem expor chaves, senhas ou conteúdo desnecessário de conversas.
3. Registrar horários exatos de dois testes novos e curtos:
   - Débora envia uma frase única, por exemplo `teste lid 1108`.
   - Chico envia uma frase única, por exemplo `teste ia 1108`.
4. Consultar de forma somente leitura os eventos, mensagens pendentes e fila relacionados a esses horários.
5. Não apagar contatos, conversas ou mensagens como tentativa de correção.

**Saída da fase:** diagnóstico baseado no evento real, não em suposição.

## Fase 2 — corrigir a identidade de entrada da Débora

1. Localizar no registro do webhook se a mensagem chega como telefone normal (`@s.whatsapp.net`) ou LID (`@lid`).
2. Se vier como LID, identificar qual informação a versão instalada da Evolution disponibiliza para relacionar o LID ao telefone:
   - telefone alternativo já presente no evento; ou
   - consulta de identidade disponibilizada pela própria Evolution.
3. Implementar um resolvedor específico da Evolution; não reutilizar o cliente WAHA para essa tarefa.
4. Salvar o vínculo LID ↔ telefone/contato de maneira durável e por organização, evitando duplicar o contato da Débora.
5. Reprocessar somente as mensagens pendentes daquele vínculo após a resolução, com idempotência para não duplicar histórico.
6. Manter a regra de grupos separada: grupos não devem entrar no Inbox comercial por acidente.

**Critérios de aceite:**

- A Débora envia uma mensagem pelo celular e ela aparece na conversa existente em até 30 segundos.
- O nome e telefone continuam no mesmo contato `By Debora Com Fé`.
- Repetir o teste não cria outro contato, outra conversa ou uma mensagem duplicada.
- O envio CRM → Débora continua funcionando.

## Fase 3 — descobrir e corrigir “Devolver para IA”

1. Executar a ação uma vez numa conversa de teste e verificar a resposta da rota `POST /api/v1/conversations/:id/ai-control`.
2. Conferir imediatamente no banco o valor de `ai_control_mode` da conversa.
3. Classificar a causa antes de editar:
   - **rota falha:** capturar código/resposta e corrigir validação, autorização ou atualização;
   - **banco atualiza, mas UI não muda:** corrigir invalidação/atualização de dados da tela;
   - **banco volta para pausado:** localizar a automação/regra que sobrescreve o valor e corrigir somente ela.
4. Garantir que a confirmação visual seja inequívoca:
   - `IA pausada nesta conversa` para pausa;
   - `IA responderá novas mensagens` para ativação individual;
   - `IA autorizada — aguardando liberação do humano` quando houver responsável humano;
   - `IA seguindo a regra geral` somente quando não houver exceção individual.
5. Exibir uma confirmação de sucesso ou erro compreensível após cada mudança, sem depender apenas do botão mudar de texto.

**Critérios de aceite:**

- Em Chico, `Devolver para IA` passa a mostrar `IA responderá novas mensagens` sem recarregar a página.
- Ao atualizar a página, o estado continua ativo.
- `Pausar IA neste contato` volta para pausado e também persiste após atualizar.
- `Pegar para mim` deixa claro que a IA fica autorizada, porém não responde enquanto o humano for responsável.

## Fase 4 — teste real da resposta automática

Antes do teste real, a política da chave geral deve obedecer a estas regras:

1. A chave fica no topo de **Agentes IA** e somente administradores podem alterá-la.
2. **Ligada:** a IA responde todas as conversas elegíveis; o Inbox não oferece ativação individual.
3. **Desligada:** a IA não responde por padrão e o Inbox permite ativar somente contatos escolhidos para teste.
4. `Pegar para mim` pausa a IA e entrega a conversa ao humano.
5. `Liberar atendimento` remove o humano e volta a conversa para a regra geral. Se a chave estiver desligada, a IA continua desligada; se estiver ligada, volta a responder.
6. Follow-ups continuam independentes da chave geral e só funcionam quando inscritos em um fluxo publicado.

Somente depois de a Fase 3 passar:

1. Deixar Chico com `Sophia`, sem responsável humano e IA individual ativa.
2. Confirmar que o `worker` está saudável e que a fila recebe o evento de mensagem.
3. Chico envia uma mensagem nova e simples pelo WhatsApp.
4. Verificar a sequência completa:
   - mensagem entra no Inbox;
   - evento de despacho é criado;
   - worker processa o evento;
   - Sophia gera resposta sem erro de credencial/guardrail;
   - resposta aparece no CRM e no WhatsApp do Chico.
5. Se não responder, registrar em qual elo a sequência parou. Não alterar prompt, credencial ou regras de forma aleatória.

**Critério de aceite:** uma resposta automática real, visível no CRM e no celular do Chico, com o log do worker confirmando o processamento.

## Fase 5 — regressão e entrega segura

1. Testar novamente Débora, Chico e um terceiro contato comum.
2. Testar uma conversa atribuída a humano para confirmar que a IA não responde indevidamente.
3. Rodar verificações do projeto e validar as telas autenticadas após o deploy.
4. Fazer um único commit claro, push e deploy no EasyPanel.
5. Só declarar concluído quando os quatro cenários abaixo passarem:

| Cenário | Resultado esperado |
| --- | --- |
| Débora envia do celular | entra no mesmo Inbox/contato |
| Chico com IA ativa | Sophia responde |
| Contato com humano responsável | IA não responde |
| Contato comum | sincronização de entrada e saída preservada |
| Chave geral ligada | IA atende contato elegível sem ativação individual |
| Chave geral desligada | somente contato ativado manualmente recebe IA |
| Pegar/Liberar | humano pausa; liberar volta à regra geral |

## Fora do escopo desta retomada

- Nova migração de provedor WhatsApp.
- Campanhas, follow-ups e grupos de gestores.
- Mudanças de prompt, conhecimento ou modelo da Sophia, salvo se o log provar que são a causa direta da resposta não sair.
- Alterações destrutivas em contatos ou conversas existentes.
