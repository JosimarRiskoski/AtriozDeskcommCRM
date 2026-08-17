"use client";
import { AlertsBell } from "./AlertsBell";
import { TenantSwitcher } from "./TenantSwitcher";
import { UserMenu } from "./UserMenu";
import { SearchTrigger } from "./SearchTrigger";
import { GlobalSearchDialog } from "./GlobalSearchDialog";
import { AgendaQuickMenu } from "./AgendaQuickMenu";

export function TopBar() {
  return (
    <header className="bg-background/95 sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b px-6 backdrop-blur">
      <div className="flex items-center gap-2">
        <TenantSwitcher />
      </div>
      <div className="flex flex-1 justify-center">
        <SearchTrigger />
      </div>
      <div className="flex items-center gap-2">
        <AgendaQuickMenu />
        <AlertsBell />
        <UserMenu />
      </div>
      <GlobalSearchDialog />
    </header>
  );
}
