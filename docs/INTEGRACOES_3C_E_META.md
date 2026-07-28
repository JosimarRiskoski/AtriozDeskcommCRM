# Integrações 3C e Meta — operação segura

## Entrada de leads da 3C

No CRM, abra **Webhooks → Nova fonte**, selecione **3C — contrato protegido**, escolha o funil e a etapa e crie um segredo com pelo menos 16 caracteres. A URL criada pertence somente à organização atual; a 3C não recebe chave do Supabase.

A 3C deve enviar JSON por `POST`, informar `external_id` único e assinar o corpo bruto com HMAC SHA-256 no cabeçalho `x-deskcomm-signature`.

```json
{
  "external_id": "3c-000123",
  "nome": "Maria da Silva",
  "telefone": "+5547999999999",
  "email": "maria@example.com"
}
```

Repetir o mesmo `external_id` retorna o lead existente e não cria duplicata. A origem fica registrada como `3c`. A integração não inicia WhatsApp, IA ou follow-up automaticamente.

## Conversões da Meta

Abra **Configurações → Conversões da Meta**. Informe Dataset/Pixel ID, token, evento, moeda e primeiro use o código de evento de teste. Mantenha **Exigir consentimento** ligado.

Quando um negócio muda realmente para ganho, o banco cria um evento único `lead-won-<id>`. Um worker envia o evento sem bloquear o Kanban. Telefone e e-mail são normalizados e convertidos em SHA-256 antes do envio; o token fica cifrado. Falha da Meta gera novas tentativas e nunca reabre nem desfaz o negócio.

Antes de ativar em produção:

- confirmar consentimento `meta_capi` no contato;
- validar um fechamento na ferramenta de eventos de teste da Meta;
- confirmar uma única linha `sent` em `meta_conversion_events`;
- repetir o fechamento/salvamento e confirmar que não existe segundo evento;
- remover o código de teste somente depois da validação.
