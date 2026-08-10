"use client";

import { useRouter } from "next/navigation";
import { CaretLeft } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";

export function BackNavigation({
  fallbackHref,
  label = "Voltar",
}: {
  fallbackHref: string;
  label?: string;
}) {
  const router = useRouter();

  const goBack = () => {
    // Este componente representa um breadcrumb conhecido, não o histórico do
    // navegador. `router.back()` podia retornar para uma rota 404 ou para outra
    // área do CRM quando o usuário havia aberto o detalhe por busca/atalho.
    router.push(fallbackHref);
  };

  return (
    <Button type="button" variant="ghost" size="sm" onClick={goBack} className="-ml-2">
      <CaretLeft size={16} aria-hidden />
      {label}
    </Button>
  );
}
