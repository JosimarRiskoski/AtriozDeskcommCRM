import { MetaCapiForm } from "./MetaCapiForm";
import { MetaCapiRules } from "./MetaCapiRules";
import { BackNavigation } from "@/components/shell/BackNavigation";
export const dynamic = "force-dynamic";
export default function MetaCapiPage() {
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <BackNavigation fallbackHref="/app/settings" label="Voltar às configurações" />
      <header>
        <h1 className="text-2xl font-semibold">Conversões da Meta</h1>
        <p className="text-sm text-muted-foreground">
          Configure a conexão e os marcos por etapa. Os marcos automáticos só entram na fila depois
          que forem explicitamente ativados.
        </p>
      </header>
      <MetaCapiForm />
      <MetaCapiRules />
    </div>
  );
}
