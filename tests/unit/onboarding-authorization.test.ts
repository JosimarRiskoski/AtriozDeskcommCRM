import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
import { requireOnboardingCtx } from "@/app/actions/onboarding/_shared";

beforeEach(() => vi.clearAllMocks());
it.each([[401, "auth_required"], [403, "forbidden"], [503, "db_error"]])("rejects authorization failure %s before creating an administrative client", async (status, code) => {
  mocks.requireRole.mockResolvedValue({ ok: false, response: { status } });
  await expect(requireOnboardingCtx()).rejects.toMatchObject({ code });
  expect(mocks.requireRole).toHaveBeenCalledWith("admin", { resource: "onboarding" });
  expect(mocks.admin).not.toHaveBeenCalled();
});
it("uses the organization and role returned by the canonical authorization gate", async () => {
  mocks.requireRole.mockResolvedValue({ ok: true, user: { id: "user", full_name: "Test", email: "test@example.test" }, org: { orgId: "allowed", name: "Test", role: "admin" } });
  expect(await requireOnboardingCtx()).toMatchObject({ userId: "user", orgId: "allowed", role: "admin" });
  expect(mocks.requireRole).toHaveBeenCalledWith("admin", { resource: "onboarding" });
});
