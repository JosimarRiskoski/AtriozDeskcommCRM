import { MetaCapiForm } from "./MetaCapiForm";
import { BackNavigation } from "@/components/shell/BackNavigation";
export const dynamic = "force-dynamic";
export default function MetaCapiPage() {
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <BackNavigation fallbackHref="/app/settings" label="Voltar às configurações" />
      <header>
        <h1 className="text-2xl font-semibold">Conversões da Meta</h1>
        <p className="text-sm text-muted-foreground">
          Configure o marco comercial. O envio só acontece quando um usuário confirma manualmente na
          oportunidade.
        </p>
      </header>
      <MetaCapiForm />
    </div>
  );
}
