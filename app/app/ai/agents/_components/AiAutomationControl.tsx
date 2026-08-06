"use client";

import { Switch } from "@/components/ui/switch";
import { useAiAutomation } from "@/hooks/ai/useAiAutomation";

export function AiAutomationControl({ canWrite }: { canWrite: boolean }) {
  const { data, isLoading, update } = useAiAutomation();
  const enabled = data?.enabled_for_all ?? false;

  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-4">
      <div>
        <h2 className="font-medium">IA automática para todas as conversas</h2>
        <p className="text-sm text-muted-foreground">
          {enabled
            ? "Ligada: a IA responde conversas elegíveis. Ao pegar uma conversa, o humano assume."
            : "Desligada: a IA só responde contatos ativados manualmente no Inbox, ideal para testes."}
        </p>
      </div>
      <div className="flex items-center gap-3 text-sm font-medium">
        <span>{enabled ? "Ligada" : "Desligada"}</span>
        <Switch
          checked={enabled}
          disabled={!canWrite || isLoading || update.isPending}
          onCheckedChange={(checked) => update.mutate(checked)}
          aria-label="IA automática para todas as conversas"
        />
      </div>
    </section>
  );
}
