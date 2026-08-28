import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("token do socket Realtime", () => {
  let createClient: typeof import("@/lib/supabase/browser").createClient;
  let reset: typeof import("@/lib/supabase/browser").__resetRealtimeToken;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("@supabase/ssr", () => ({
      createBrowserClient: vi.fn(() => ({ realtime: {} })),
    }));
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-test");
    const browser = await import("@/lib/supabase/browser");
    createClient = browser.createClient;
    reset = browser.__resetRealtimeToken;
    reset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock("@supabase/ssr");
  });

  async function installedCallback(): Promise<() => Promise<string | null>> {
    const { createBrowserClient } = await import("@supabase/ssr");
    createClient();
    const options = vi.mocked(createBrowserClient).mock.calls.at(-1)?.[2] as
      | { realtime?: { accessToken?: () => Promise<string | null> } }
      | undefined;
    const callback = options?.realtime?.accessToken;
    if (!callback) throw new Error("callback accessToken não instalada");
    return callback;
  }

  it("entrega o JWT do usuário ao socket, nunca a anon key", async () => {
    const callback = await installedCallback();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { access_token: "jwt-user", expires_at: null } }),
      }),
    );
    await expect(callback()).resolves.toBe("jwt-user");
  });

  it("coalesce canais simultâneos e não guarda falhas", async () => {
    const callback = await installedCallback();
    const failed = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", failed);
    await Promise.all([callback(), callback(), callback()]);
    expect(failed).toHaveBeenCalledTimes(1);

    const recovered = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { access_token: "jwt-recovered", expires_at: null } }),
    });
    vi.stubGlobal("fetch", recovered);
    await expect(callback()).resolves.toBe("jwt-recovered");
  });
});
