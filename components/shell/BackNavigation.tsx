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
    const sameOriginReferrer = document.referrer.startsWith(window.location.origin);
    if (sameOriginReferrer && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  };

  return (
    <Button type="button" variant="ghost" size="sm" onClick={goBack} className="-ml-2">
      <CaretLeft size={16} aria-hidden />
      {label}
    </Button>
  );
}
