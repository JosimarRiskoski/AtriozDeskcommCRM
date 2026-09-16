import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(), factors: vi.fn(), audit: vi.fn(), redirect: vi.fn(), provision: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit, hashEmail: () => "hash" }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithPassword: mocks.signIn, mfa: { listFactors: mocks.factors } } }),
}));
vi.mock("@/lib/auth/provision", () => ({ ensureTenantForUser: mocks.provision }));
import { signInWithPassword } from "@/app/actions/auth/signInWithPassword";

const input = { email: "login@example.test", password: "test-password" };
describe("sign-in server action", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.signIn.mockResolvedValue({ data: { user: { id: "user" } }, error: null });
    mocks.factors.mockResolvedValue({ data: { totp: [] }, error: null });
    mocks.provision.mockResolvedValue({ provisioned: false });
    mocks.redirect.mockImplementation((url) => { throw new Error(`redirect:${url}`); });
  });
  it.each([429, 503])("returns operational error %s without continuing to MFA", async (status) => {
    mocks.signIn.mockResolvedValue({ data: { user: null }, error: { status } });
    expect(await signInWithPassword(input)).toMatchObject({ error: status === 429 ? "rate_limited" : "service_unavailable" });
    expect(mocks.factors).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it.each([
    { data: null, error: { status: 503 } },
    { data: null, error: null },
  ])("does not complete login when factor discovery is unavailable", async (result) => {
    mocks.factors.mockResolvedValue(result);
    expect(await signInWithPassword(input)).toMatchObject({ error: "service_unavailable" });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalledWith(expect.objectContaining({ action: "auth.login_success" }));
  });
  it("requires the verified factor without redirecting into CRM", async () => {
    mocks.factors.mockResolvedValue({ data: { totp: [{ id: "factor", status: "verified" }] }, error: null });
    expect(await signInWithPassword(input)).toMatchObject({ error: "mfa_required", challengeId: "factor" });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it.each([
    ["https://outside.test", "/app/inbox"],
    ["/team/accept-invite/example", "/team/accept-invite/example"],
  ])("validates destination at server boundary", async (next, destination) => {
    await expect(signInWithPassword(input, next)).rejects.toThrow(`redirect:${destination}`);
    expect(mocks.redirect).toHaveBeenCalledWith(destination);
  });
  it("retakes an interrupted self-service provisioning without affecting invite accounts", async () => {
    mocks.signIn.mockResolvedValue({
      data: { user: { id: "user", user_metadata: { org_name: "Empresa" } } },
      error: null,
    });
    mocks.provision.mockResolvedValue({ provisioned: true, organizationId: "org" });
    await expect(signInWithPassword(input)).rejects.toThrow("redirect:/onboarding/welcome");
    expect(mocks.provision).toHaveBeenCalledTimes(1);

    mocks.signIn.mockResolvedValue({
      data: { user: { id: "invite", user_metadata: { invited: true, org_name: "Não criar" } } },
      error: null,
    });
    await expect(signInWithPassword(input)).rejects.toThrow("redirect:/app/inbox");
    expect(mocks.provision).toHaveBeenCalledTimes(1);
  });
});
