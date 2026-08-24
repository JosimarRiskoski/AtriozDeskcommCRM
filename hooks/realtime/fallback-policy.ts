import type { RealtimeStatus } from "@/hooks/realtime/useRealtimeChannel";

/**
 * Realtime entrega mudanças imediatamente. O refetch periódico existe somente
 * como rede de segurança para canal autenticado que morreu silenciosamente.
 *
 * Canal saudável: uma conferência por minuto.
 * Canal degradado: confere a cada 30s até a assinatura se recuperar. Dez
 * segundos ainda permitiam milhares de leituras por dia por aba quando o
 * Realtime ficava indisponível por horas.
 */
export const REALTIME_FALLBACK_HEALTHY_MS = 60_000;
export const REALTIME_FALLBACK_DEGRADED_MS = 30_000;

export function realtimeFallbackIntervalMs(status: RealtimeStatus): number {
  return status === "subscribed" ? REALTIME_FALLBACK_HEALTHY_MS : REALTIME_FALLBACK_DEGRADED_MS;
}
