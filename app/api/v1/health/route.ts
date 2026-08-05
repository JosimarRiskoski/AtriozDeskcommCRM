import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CheckStatus = "ok" | "degraded" | "down";
type Check = { status: CheckStatus; latency_ms: number; error?: string };

const TIMEOUT_MS = 3_000;

async function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}

async function checkSupabase(): Promise<Check> {
  const t0 = Date.now();
  try {
    // Ping leve via REST com anon key — não precisa de service_role pra health check.
    // Se chegar 200/401/empty body, conexão e API key estão OK.
    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const res = await withTimeout(
      fetch(`${url}/rest/v1/organizations?select=id&limit=1`, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        cache: "no-store",
      }),
    );
    // 200 (lista vazia por RLS) ou 401/403 (auth ok mas RLS bloqueia anon) → conexão OK
    if (res.status === 200 || res.status === 401 || res.status === 403) {
      return { status: "ok", latency_ms: Date.now() - t0 };
    }
    return {
      status: "down",
      latency_ms: Date.now() - t0,
      error: `http_${res.status}`,
    };
  } catch (e) {
    return {
      status: "down",
      latency_ms: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function checkRedis(): Promise<Check> {
  const t0 = Date.now();
  try {
    const url = env.UPSTASH_REDIS_REST_URL;
    const token = env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      return { status: "degraded", latency_ms: 0, error: "not_configured" };
    }
    // Protocolo REST do Upstash (compatível com serverless-redis-http): comando no
    // corpo via POST na raiz. NÃO existe GET /ping — daria 404 no SRH self-host.
    const res = await withTimeout(
      fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(["PING"]),
        cache: "no-store",
      }),
    );
    if (!res.ok) {
      return {
        status: "down",
        latency_ms: Date.now() - t0,
        error: `http_${res.status}`,
      };
    }
    return { status: "ok", latency_ms: Date.now() - t0 };
  } catch (e) {
    return {
      status: "down",
      latency_ms: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function checkEvolution(): Promise<Check> {
  const t0 = Date.now();
  try {
    const base = env.EVOLUTION_API_BASE_URL;
    if (!base || !env.EVOLUTION_API_KEY) {
      return { status: "degraded", latency_ms: 0, error: "not_configured" };
    }
    const res = await withTimeout(
      fetch(`${base.replace(/\/$/, "")}/instance/fetchInstances`, {
        headers: { apikey: env.EVOLUTION_API_KEY },
        cache: "no-store",
      }),
    );
    if (!res.ok) {
      return {
        status: "down",
        latency_ms: Date.now() - t0,
        error: `http_${res.status}`,
      };
    }
    return { status: "ok", latency_ms: Date.now() - t0 };
  } catch (e) {
    return {
      status: "down",
      latency_ms: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function GET() {
  const [supabase, redis, evolution] = await Promise.all([
    checkSupabase(),
    checkRedis(),
    checkEvolution(),
  ]);

  const checks = { supabase, redis, evolution };
  const anyDown = Object.values(checks).some((c) => c.status === "down");
  const anyDegraded = Object.values(checks).some((c) => c.status === "degraded");
  const status: "healthy" | "degraded" | "unhealthy" = anyDown
    ? "unhealthy"
    : anyDegraded
      ? "degraded"
      : "healthy";

  const httpStatus = status === "unhealthy" ? 503 : 200;

  return NextResponse.json(
    {
      data: {
        status,
        version: process.env.npm_package_version ?? "0.1.0",
        timestamp: new Date().toISOString(),
        checks,
      },
    },
    { status: httpStatus },
  );
}
