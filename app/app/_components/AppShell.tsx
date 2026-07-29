"use client";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";

interface AppShellProps {
  sidebarCollapsed: boolean;
  children: ReactNode;
}

export function AppShell({ sidebarCollapsed, children }: AppShellProps) {
  const pathname = usePathname();
  const isFullHeightWorkspace =
    pathname === "/app/inbox" ||
    pathname.startsWith("/app/inbox/") ||
    pathname.startsWith("/app/pipelines/") ||
    pathname.includes("/ai/followups/");

  return (
    <div className="flex h-screen min-h-0 w-full overflow-hidden bg-background">
      <Sidebar collapsed={sidebarCollapsed} />
      <div
        className={cn(
          "flex h-screen min-h-0 flex-1 flex-col transition-[margin] duration-200",
          sidebarCollapsed ? "ml-16" : "ml-60",
        )}
      >
        <TopBar />
        <main
          className={cn(
            "min-h-0 flex-1",
            isFullHeightWorkspace ? "overflow-hidden p-0" : "overflow-auto p-6",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
