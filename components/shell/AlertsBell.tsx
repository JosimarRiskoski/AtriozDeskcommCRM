"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Bell } from "@/lib/ui/icons";

export function AlertsBell() {
  const [count, setCount] = useState(0);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/notifications?status=unread&limit=100", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setCount(Array.isArray(json.data) ? json.data.length : 0);
    } catch {
      // O sino não pode interromper o restante da navegação.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("notifications:refresh", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("notifications:refresh", refresh);
    };
  }, [refresh]);

  return (
    <Link
      href="/app/notifications"
      aria-label={count > 0 ? `Notificações — ${count} não lidas` : "Notificações"}
      title="Notificações"
      data-testid="alerts-bell"
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Bell size={18} aria-hidden />
      {count > 0 ? (
        <span data-testid="alerts-bell-count" className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
