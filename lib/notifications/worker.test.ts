import { describe, expect, it, vi } from "vitest";

describe("notification worker helpers", () => {
  it("escapa conteúdo controlado pelo cliente antes do email", async () => {
    const { notificationWorkerInternals } = await import("./worker");
    expect(notificationWorkerInternals.escapeHtml(`<script>alert('x')</script>`)).toBe("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
  });

  it("só produz link quando existe URL pública e caminho interno", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://crm.example.com/");
    const { notificationWorkerInternals } = await import("./worker");
    expect(notificationWorkerInternals.publicUrl("/app/inbox/1")).toBe("https://crm.example.com/app/inbox/1");
    expect(notificationWorkerInternals.publicUrl(null)).toBeNull();
    vi.unstubAllEnvs();
  });
});

