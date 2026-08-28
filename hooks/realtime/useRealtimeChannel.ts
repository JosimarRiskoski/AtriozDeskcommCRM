"use client";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { createClient } from "@/lib/supabase/browser";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type RealtimeStatus = "connecting" | "subscribed" | "channel_error" | "timed_out" | "closed";

export interface UseRealtimeChannelOpts {
  name: string;
  postgresChanges?: {
    event: "INSERT" | "UPDATE" | "DELETE" | "*";
    schema?: string;
    table: string;
    filter?: string;
    /** Limita as colunas entregues pelo Realtime e evita trafegar payloads grandes. */
    select?: string[];
  };
  broadcast?: { event: string };
  onChange: (payload: unknown) => void;
  enabled?: boolean;
}

export function useRealtimeChannel(opts: UseRealtimeChannelOpts): {
  status: RealtimeStatus;
  /**
   * Instante da última entrega deste canal (`.current` é null se nunca entregou).
   *
   * ⚠️ DEVOLVE A REF, NÃO O VALOR, e isso é correção e não estilo: ler
   * `.current` aqui no render entregaria um número CONGELADO naquele render —
   * a ref muda depois e nada redesenha, então quem recebeu ficaria com carimbo
   * velho até algo mais causar um render. Funcionava por acidente (a query
   * redesenha ao invalidar), e falharia justamente na janela entre a entrega e
   * esse redesenho, que é onde o detector de perda dispara.
   *
   * Virar `useState` resolveria a propagação e criaria pior: o valor entra nas
   * dependências do efeito e o canal RE-ASSINA a cada evento, perdendo eventos
   * na reassinatura. Quem lê isto é um timer — roda fora do render e enxerga
   * `.current` sempre fresco.
   */
  ultimaEntrega: RefObject<number | null>;
} {
  const { name, postgresChanges, broadcast, onChange, enabled = true } = opts;
  const postgresSelectKey = postgresChanges?.select?.join(",") ?? "";

  // ref makes onChange identity-stable so changing handler doesn't re-subscribe
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  /**
   * QUANDO este canal entregou algo pela última vez.
   *
   * Existe para o refetch de segurança poder responder "houve entrega
   * recente?" — sem esse sinal, uma diferença entre o que o servidor tem e o
   * que a tela mostra é indistinguível de "nada aconteceu no intervalo", e a
   * checagem só consegue REPROVAR, nunca aprovar.
   *
   * `useRef` e não `useState` porque virar dependência de efeito faria o canal
   * re-assinar a cada evento, perdendo eventos na janela da reassinatura. A
   * ref ATRAVESSA a fronteira do hook em vez de ser lida aqui — ver o tipo de
   * retorno, onde está por que ler `.current` no render seria defeito.
   */
  const ultimaEntrega = useRef<number | null>(null);

  const [status, setStatus] = useState<RealtimeStatus>(enabled ? "connecting" : "closed");

  // React 19 strict mode mounts effects twice in dev. If two consumers ever
  // share the same logical channel name (or the same component re-mounts),
  // Supabase reuses the existing channel object — calling `.on()` after the
  // prior `.subscribe()` errors out. Append a stable per-instance suffix so
  // every hook call owns its own channel topology.
  const instanceId = useId();

  useEffect(() => {
    if (!enabled) {
      setStatus("closed");
      return;
    }
    const supabase = createClient();
    const channelName = `${name}::${instanceId}`;

    const handler = (payload: unknown) => {
      // Carimba ANTES de entregar: se o consumidor lançar, a entrega ainda
      // aconteceu — e o refetch de segurança precisa saber disso para não
      // acusar o canal de ter perdido o que ele trouxe.
      ultimaEntrega.current = Date.now();
      onChangeRef.current(payload);
    };

    let active: RealtimeChannel | null = null;
    let cancelado = false;
    let tentativas = 0;
    let retomada: ReturnType<typeof setTimeout> | null = null;
    setStatus("connecting");

    const montar = () => {
      if (cancelado) return;

      let novo: RealtimeChannel = supabase.channel(`${channelName}#${tentativas}`);
      if (postgresChanges) {
        novo = novo.on(
          "postgres_changes",
          {
            event: postgresChanges.event,
            schema: postgresChanges.schema ?? "public",
            table: postgresChanges.table,
            ...(postgresChanges.filter ? { filter: postgresChanges.filter } : {}),
            ...(postgresChanges.select ? { select: postgresChanges.select } : {}),
          },
          handler,
        );
      }
      if (broadcast) novo = novo.on("broadcast", { event: broadcast.event }, handler);
      active = novo;

      // A callback `realtime.accessToken` do cliente fornece e renova o token
      // antes de cada join. Este hook fica responsável apenas pela topologia e
      // recuperação do canal.
      novo.subscribe((s) => {
        if (cancelado || active !== novo) return;
        const map: Record<string, RealtimeStatus> = {
          SUBSCRIBED: "subscribed",
          CHANNEL_ERROR: "channel_error",
          TIMED_OUT: "timed_out",
          CLOSED: "closed",
        };
        setStatus(map[s] ?? "connecting");

        if (s === "SUBSCRIBED") {
          // O Realtime não repassa eventos ocorridos durante a queda. Uma
          // invalidação sintética força os consumidores a buscar o estado
          // atual e fecha a lacuna sem esperar uma nova mensagem.
          if (tentativas > 0) {
            tentativas = 0;
            handler({ tipo: "reassinado" });
          }
          return;
        }

        if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
          const espera = Math.min(30_000, 1_000 * 2 ** tentativas);
          tentativas++;
          if (retomada) clearTimeout(retomada);
          retomada = setTimeout(() => {
            if (cancelado) return;
            if (active) supabase.removeChannel(active);
            montar();
          }, espera);
        }
      });
    };

    montar();

    return () => {
      cancelado = true;
      if (retomada) clearTimeout(retomada);
      if (active) {
        supabase.removeChannel(active);
        active = null;
      }
    };
    // intentionally omit onChange (ref); only re-subscribe when channel topology changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    name,
    enabled,
    instanceId,
    postgresChanges?.event,
    postgresChanges?.table,
    postgresChanges?.filter,
    postgresChanges?.schema,
    postgresSelectKey,
    broadcast?.event,
  ]);

  return { status, ultimaEntrega };
}
