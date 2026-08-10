# tests/unit/

Vitest. Unidades puras (sem rede/DB).

## Foco

- `lib/api/wrappers.test.ts` — formato de response, status codes, X-Request-Id
- `lib/api/errors.test.ts` — códigos não duplicados / não renomeados
- `lib/env.test.ts` — schema Zod aceita combos válidos, rejeita inválidos
- `lib/whatsapp/stop-detection.test.ts` — regex STOP/PARAR/SAIR/UNSUBSCRIBE
- `tests/unit/evolution-receipts.test.ts` — progressão monotônica dos recibos
- `tests/unit/evolution-media-source.test.ts` — formatos e limites de mídia
- `lib/api/pagination.test.ts` — encode/decode cursor + tampering rejected

## Comandos

```bash
npm run test:unit
npm run test:unit -- --watch
```
