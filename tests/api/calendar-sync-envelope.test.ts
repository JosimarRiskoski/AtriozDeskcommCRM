import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import { syncGoogleCalendar } from "@/lib/calendar/sync";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/calendar/sync", () => ({ syncGoogleCalendar: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

describe("POST /api/v1/calendar/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("converte uma exceção anterior à sincronização em envelope JSON", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("unexpected_auth_failure"));
    const { POST } = await import("@/app/api/v1/calendar/sync/route");

    const response = await POST();

    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({
      error: { code: "calendar_sync_failed", message: "Não foi possível sincronizar o Google Agenda." },
    });
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "calendar.sync.request_failed",
      expect.objectContaining({ error_type: "Error", requestId: expect.any(String) }),
    );
  });

  it("mantém a resposta de sucesso JSON", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({
      ok: true,
      user: { id: "user", email: "u@example.com", full_name: null, avatar_url: null, is_platform_admin: false, organizations: [] },
      org: { orgId: "org", name: "Org", role: "manager" },
    });
    vi.mocked(createAdminClient).mockReturnValue({} as never);
    vi.mocked(syncGoogleCalendar).mockResolvedValueOnce({
      imported_or_updated: 2,
      cancelled: 1,
      completed_at: "2026-09-02T18:00:00.000Z",
    });
    const { POST } = await import("@/app/api/v1/calendar/sync/route");

    const response = await POST();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ data: { imported_or_updated: 2, cancelled: 1 } });
  });
});
