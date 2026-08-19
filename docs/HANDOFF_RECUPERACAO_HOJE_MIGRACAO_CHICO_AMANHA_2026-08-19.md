# Handoff — recuperação hoje e migração para o Chico amanhã

**Projeto:** Átrioz CRM  
**Data:** 19/08/2026  
**Documento principal:** `docs/PLANO_MESTRE_ESTABILIZACAO_SUPABASE_E_BACKUP_2026-08-19.md`

## Decisão do responsável

O Supabase atual pertence ao Josimar e é apenas o ambiente de teste. O ambiente definitivo deve ser criado na conta/organização do Chico.

Josimar ficará disponível hoje somente até o CRM atual voltar a ser acessível e operar sem lentidão anormal. A partir da criação do Supabase do Chico, todo o trabalho será retomado amanhã com Josimar presente.

## Missão autorizada para a meta de hoje

Depois que Josimar ativar a meta, trabalhar até recuperar o ambiente atual:

1. registrar fotografia técnica e preservar a possibilidade de rollback;
2. reduzir as consultas excessivas do Inbox;
3. reduzir as consultas excessivas da fila da IA;
4. remover chamadas agendadas vazias já comprovadas;
5. tornar o health check leve;
6. executar testes proporcionais ao risco;
7. criar commits pequenos e identificáveis;
8. enviar e implantar as correções;
9. validar login, carregamento do CRM, Inbox e ausência de lentidão anormal;
10. acompanhar sinais iniciais de redução de CPU, I/O, consultas e erros.

## Condição de encerramento de hoje

Considerar a missão de hoje concluída somente quando houver evidência de que:

- a página de login abre normalmente;
- o login conclui;
- a navegação principal do CRM carrega;
- o Inbox abre e lista conversas;
- abrir uma conversa não dispara erros repetidos;
- a lentidão anormal desapareceu ou foi reduzida a ponto de permitir operação;
- não foi realizada nenhuma troca de banco.

Se o ambiente continuar indisponível, registrar exatamente o bloqueio, as verificações realizadas e a próxima ação. Não avançar para migração como tentativa improvisada de correção.

## Limite rígido — não executar hoje

Não realizar sem Josimar presente:

- criação do Supabase do Chico;
- criação de nova organização ou conta para contornar cota;
- restauração no banco novo;
- transferência de Auth ou usuários;
- cópia de Storage;
- alteração das chaves Supabase no EasyPanel;
- corte do CRM para o novo banco;
- exclusão, pausa ou limpeza destrutiva do banco atual.

## Trabalho de amanhã — fazer em conjunto

1. autenticar na conta correta do Chico;
2. criar o projeto Supabase definitivo e organizado;
3. gerar e conferir o pacote final de backup;
4. restaurar estrutura, regras, dados e histórico de migrations;
5. configurar Auth, Realtime, Storage, URLs e integrações;
6. validar dados e relações;
7. testar login, convite, Inbox, WhatsApp, IA, campanhas, agenda, Google Calendar e Meta CAPI;
8. atualizar o EasyPanel em uma janela controlada;
9. fazer o corte e testes ponta a ponta;
10. manter o Supabase antigo intacto para rollback.

## O que será necessário do Josimar amanhã

- entrar na conta Supabase correta do Chico;
- acompanhar a criação e identificação do projeto;
- executar SQL somente quando solicitado ou autorizar sua execução pela interface;
- participar do teste final com WhatsApp;
- aprovar explicitamente o corte antes da troca das variáveis do EasyPanel.

## Estado ao entregar este handoff

- plano revisado para duas janelas;
- nenhuma migração ou troca de banco foi realizada;
- polling ocioso do Inbox reduzido de 2 segundos para fallback adaptativo de 60 segundos com Realtime saudável e 10 segundos quando degradado;
- autenticação do canal Realtime agora distingue assinatura autenticada de assinatura anônima, mantendo o fallback de segurança quando necessário;
- worker alterado de consulta fixa a cada 250 ms para backoff ocioso entre 1 e 10 segundos, com retomada imediata quando encontra trabalho;
- health check do worker deixou de consultar métricas de negócio no banco;
- chamada agendada do `agent-dispatcher`, já obsoleta e sem efeito, removida do Compose;
- testes unitários direcionados: 10 aprovados;
- `pnpm typecheck` e `pnpm build`: aprovados;
- commits publicados: `ddd37b06` e `cb1619b0`;
- commit adicional publicado: `f4e584b1`, contendo a contenção da tempestade de eventos da Evolution, descarte antecipado de eventos sem uso e desativação da sincronização integral de histórico;
- deploy do commit `cb1619b0` concluído no EasyPanel em aproximadamente 6 minutos;
- verificação externa após o deploy: login HTTP 200 em aproximadamente 0,90 s; rota protegida do Inbox redirecionou corretamente ao login em aproximadamente 0,49 s;
- tela de login carregada visualmente em aproximadamente 0,9 s e sem erros no console;
- o Compose do CRM foi parado temporariamente para interromper a carga sobre o Supabase; com o CRM desligado, permaneceram apenas poucas sessões ociosas no banco;
- o projeto Supabase atual foi reiniciado pela interface e voltou a disponibilizar Auth e os demais serviços;
- o Compose foi iniciado novamente com a correção `f4e584b1`; após o pico de inicialização, a utilização observada no EasyPanel caiu para aproximadamente 2,5% de CPU;
- teste de autenticação com conta inexistente retornou rapidamente o erro esperado, sem novo `504` e sem permanecer indefinidamente em “Entrando”;
- login real de Josimar concluído com sucesso;
- Inbox autenticado carregou 494 conversas sem erro de carregamento;
- conversa com histórico extenso e mídias abriu em aproximadamente 2,6 s, exibindo o compositor de resposta;
- tela de Conexões abriu em aproximadamente 2,0 s, sem erro, exibindo os dois números configurados;
- retorno ao Inbox ocorreu em aproximadamente 1,6 s; outra conversa da fila abriu em aproximadamente 2,2 s, com mensagens e compositor disponíveis;
- nenhuma criação, restauração, migração ou troca de chaves para o Supabase do Chico foi realizada;
- a Janela 1 foi concluída; a migração controlada descrita em “Trabalho de amanhã” permanece pendente para execução conjunta.
