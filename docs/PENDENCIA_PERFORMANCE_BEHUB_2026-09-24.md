# Pendência de performance para futura atualização da BeHub

## Estado

Não aplicar na BeHub agora. A BeHub mantém banco Supabase próprio e deve receber somente correções de código já medidas e validadas no CRM Átrioz.

## Evidência observada no CRM Átrioz em 24/09/2026

- Supabase saudável, compute `nano`, CPU em 9%, RAM em 73% e 37/60 conexões.
- Apenas 2 consultas ativas, sem consultas bloqueadas e sem transações ociosas abertas.
- Health do CRM: mediana aproximada de 0,67 s em cinco medições; Supabase em 176 ms.
- O relatório cumulativo de `pg_stat_statements` mostrou alta frequência histórica em `event_log`, filas, recuperação inbound, campanhas e Realtime, mas baixa duração média por chamada.
- `fn_inbox_counts` apresentou máximo acumulado aproximado de 7,69 s, média
  de 819 ms e mínimo de 74 ms.
- O projeto registrou 24.464 requisições e 95,3% de sucesso na janela de 60 minutos do painel.
- O Supabase exibia incidente técnico ativo; os relatórios detalhados de API e logs não carregaram dados suficientes para atribuir os 4xx a uma rota específica.

## Regra para a correção

1. Identificar nos logs o status e pathname responsáveis pelos 4xx antes de alterar intervalos.
2. Medir a mesma janela antes e depois no CRM Átrioz.
3. Preservar Realtime, RLS, isolamento por organização, filas, entrega inbound/outbound e tempo de resposta da IA.
4. Não reduzir polling crítico se isso atrasar mensagens, IA, campanhas ou recuperação de falhas.
5. Depois de validar no Átrioz, portar apenas o código da correção para o repositório BeHub.
6. Não copiar banco, dados, sessões, WhatsApp, webhooks ou credenciais do Átrioz.
7. Validar novamente usando o Supabase próprio da BeHub, aberto no Chrome externo com perfil Francisco/Chico.

## Correção preparada no Átrioz

- A migração `0145_optimize_inbox_counts` elimina duas execuções por linha
  de `conversation_command(c)` na contagem do Inbox.
- A classificação continua idêntica: conversa com responsável é humana;
  conversa encerrada é finalizada; somente conversa sem responsável pode entrar
  em Fila ou Automático.
- A RLS continua ativa porque a função permanece `SECURITY INVOKER`.
- Ainda não aplicar na BeHub. Primeiro medir e homologar no Átrioz; depois
  portar a mesma migração para o banco exclusivo da BeHub.

## Critério antes de subir na BeHub

- Logs identificam a causa original.
- Testes do Inbox, worker, filas e isolamento aprovados.
- Build aprovado.
- Comparação antes/depois demonstra redução de chamadas ou erros sem aumento relevante de latência.
- Deploy separado e homologação no ambiente BeHub.
