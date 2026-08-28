/**
 * Supabase client para Client Components (browser).
 *
 * Use este em qualquer arquivo com "use client". NUNCA em Server Components,
 * Route Handlers, ou middleware — eles devem usar `lib/supabase/server.ts`.
 *
 * Sessão persiste via cookie SameSite=Strict gerenciado pelo @supabase/ssr.
 */

import { createBrowserClient } from "@supabase/ssr";

let _client: ReturnType<typeof createBrowserClient> | null = null;

const REALTIME_TOKEN_REFRESH_MARGIN_MS = 60_000;
let realtimeTokenCache: { value: string; expiresAt: number } | null = null;
let realtimeTokenRequest: Promise<string | null> | null = null;

/** Exposto apenas para os testes isolarem o cache entre cenários. */
export function __resetRealtimeToken(): void {
  realtimeTokenCache = null;
  realtimeTokenRequest = null;
}

async function getRealtimeToken(): Promise<string | null> {
  if (
    realtimeTokenCache &&
    Date.now() < realtimeTokenCache.expiresAt - REALTIME_TOKEN_REFRESH_MARGIN_MS
  ) {
    return realtimeTokenCache.value;
  }

  realtimeTokenRequest ??= (async () => {
    try {
      const response = await fetch("/api/v1/auth/realtime-token", {
        credentials: "include",
      });
      if (!response.ok) return null;
      const body = (await response.json()) as {
        data?: { access_token?: string; expires_at?: number | null };
      };
      const value = body.data?.access_token;
      if (!value) return null;
      realtimeTokenCache = {
        value,
        // Sem expiração, a próxima chamada consulta novamente em vez de servir
        // indefinidamente um token que pode ter morrido.
        expiresAt: body.data?.expires_at ? body.data.expires_at * 1000 : 0,
      };
      return value;
    } catch {
      return null;
    } finally {
      realtimeTokenRequest = null;
    }
  })();

  return realtimeTokenRequest;
}

export function createClient() {
  // Singleton no browser pra reaproveitar canais Realtime e auth state.
  if (_client) return _client;

  // Self-host (imagem genérica): valores injetados em runtime pelo
  // <PublicEnvScript/>. Vercel/dev: fallback pro process.env.NEXT_PUBLIC_*
  // (baked em build). Ler a URL do Supabase daqui é o que permite uma única
  // imagem servir qualquer projeto Supabase sem rebuild.
  const runtime =
    typeof window !== "undefined" ? window.__PUBLIC_ENV__ : undefined;
  const url = runtime?.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    runtime?.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "[supabase/browser] NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_ANON_KEY ausentes.",
    );
  }

  _client = createBrowserClient(url, key, {
    // D-01.01: cookie name canônico alinhado ao middleware/server.
    cookieOptions: {
      name: "sb-deskcomm-auth",
      sameSite: "strict",
      path: "/",
    },
    // Fonte única de autenticação do socket. Funciona no join, heartbeat e
    // reconexão, inclusive com a sessão guardada em cookie httpOnly.
    realtime: { accessToken: getRealtimeToken },
  });
  return _client;
}
