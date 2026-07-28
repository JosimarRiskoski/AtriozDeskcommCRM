"use client";

import { useHotkeys } from "react-hotkeys-hook";
import { MagnifyingGlass } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";

export function SearchTrigger() {
  const openSearch = () => {
    // A busca funcional será ligada ao índice multi-organização no próximo lote.
    // O controle já ocupa o espaço correto e expõe o atalho de forma legível.
    window.dispatchEvent(new CustomEvent("deskcomm:open-global-search"));
  };

  useHotkeys("mod+k", openSearch, { preventDefault: true });

  return (
    <Button
      variant="outline"
      size="sm"
      className="w-10 justify-start gap-2 px-2 text-muted-foreground sm:w-80 sm:px-3 md:w-[min(42rem,48vw)]"
      aria-label="Abrir busca global"
      onClick={openSearch}
    >
      <MagnifyingGlass size={14} aria-hidden />
      <span className="hidden flex-1 text-left sm:inline">Buscar no CRM...</span>
      <kbd className="ml-auto hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] sm:inline">⌘K</kbd>
    </Button>
  );
}
