"use client";
import { AlertsBell } from "./AlertsBell";
import { TenantSwitcher } from "./TenantSwitcher";
import { UserMenu } from "./UserMenu";
import { SearchTrigger } from "./SearchTrigger";
import { GlobalSearchDialog } from "./GlobalSearchDialog";

export function TopBar() {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b bg-background/95 px-6 backdrop-blur">
      <div className="flex items-center gap-2">
        <TenantSwitcher />
      </div>
      <div className="flex flex-1 justify-center">
        <SearchTrigger />
      </div>
      <div className="flex items-center gap-2">
        <AlertsBell />
        <UserMenu />
      </div>
      <GlobalSearchDialog />
    </header>
  );
}
