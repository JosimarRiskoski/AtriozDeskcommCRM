"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { StepProgress } from "@/components/ui/step-progress";

interface StepDialogFormProps extends React.FormHTMLAttributes<HTMLFormElement> {
  labels: string[];
  currentStep: number;
  footer: React.ReactNode;
}

/**
 * Estrutura reutilizável para formulários longos em modal.
 *
 * Mantém o progresso e os botões sempre visíveis, enquanto somente o conteúdo
 * da etapa rola. Assim o usuário nunca precisa procurar o botão de continuar
 * ou salvar fora da altura útil da tela.
 */
export function StepDialogForm({
  labels,
  currentStep,
  footer,
  children,
  className,
  ...props
}: StepDialogFormProps) {
  return (
    <form
      {...props}
      className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-hidden", className)}
    >
      <div className="shrink-0">
        <StepProgress labels={labels} current={currentStep} />
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">{children}</div>
      <div className="shrink-0 border-t border-border pt-4">{footer}</div>
    </form>
  );
}
