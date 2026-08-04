"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api/client";
import type { KnowledgeSourceType } from "@/components/ai/KnowledgeSourceCard";

const LABEL: Record<KnowledgeSourceType, string> = {
  faq: "FAQ",
  policy: "Política",
  conversations: "Conversas opt-in",
  catalog: "Catálogo",
};

export function ConfigureKnowledgeSourceDialog({
  open,
  type,
  agentId,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  type: KnowledgeSourceType | null;
  agentId: string;
  onOpenChange: (next: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !type) return;
    setName(LABEL[type]);
    setMarkdown("");
    setFile(null);
  }, [open, type]);

  if (!type) return null;

  async function submit() {
    if (name.trim().length < 2) {
      toast.error("Informe um nome para esta fonte.");
      return;
    }
    if (type === "policy" && !file) {
      toast.error("Selecione um arquivo PDF ou Markdown.");
      return;
    }
    if (type === "faq" && markdown.trim().length === 0) {
      toast.error("Inclua pelo menos uma pergunta e resposta.");
      return;
    }
    setBusy(true);
    try {
      if (type === "policy") {
        const form = new FormData();
        form.set("agent_id", agentId);
        form.set("name", name.trim());
        form.set("file", file!);
        const response = await fetch("/api/v1/ai/knowledge/sources/upload", {
          method: "POST",
          body: form,
        });
        const json = await response.json().catch(() => null);
        if (!response.ok) throw new Error(json?.error?.message ?? "Não foi possível enviar o arquivo.");
      } else {
        await apiClient.post("/api/v1/ai/knowledge/sources", {
          agent_id: agentId,
          source_type: type,
          name: name.trim(),
          ...(type === "faq" ? { markdown_blob: markdown.trim() } : {}),
        });
      }
      toast.success(`${LABEL[type ?? "faq"]} configurada. Agora você pode reindexar quando necessário.`);
      onCreated();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível configurar a fonte.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Configurar {LABEL[type]}</DialogTitle>
          <DialogDescription>
            Esta fonte ficará disponível para o agente selecionado. A IA só usa conteúdo que esteja configurado e indexado aqui.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="knowledge-name">Nome</Label>
            <Input id="knowledge-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          {type === "faq" ? (
            <div className="space-y-2">
              <Label htmlFor="knowledge-faq">Perguntas e respostas</Label>
              <Textarea
                id="knowledge-faq"
                rows={9}
                value={markdown}
                onChange={(event) => setMarkdown(event.target.value)}
                placeholder={"## Pergunta: Qual é o prazo?\n## Resposta: O prazo é de até 7 dias úteis."}
              />
              <p className="text-xs text-muted-foreground">Use uma seção “## Pergunta:” seguida de “## Resposta:” para cada item.</p>
            </div>
          ) : null}
          {type === "policy" ? (
            <div className="space-y-2">
              <Label htmlFor="knowledge-file">Arquivo PDF ou Markdown</Label>
              <Input
                id="knowledge-file"
                type="file"
                accept=".pdf,.md,application/pdf,text/markdown,text/plain"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">Máximo de 20 MB.</p>
            </div>
          ) : null}
          {type === "conversations" ? <p className="text-sm text-muted-foreground">O CRM usará apenas conversas autorizadas e anonimizadas para aprendizado.</p> : null}
          {type === "catalog" ? <p className="text-sm text-muted-foreground">A fonte será preparada para o catálogo sincronizado da operação.</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button type="button" onClick={() => void submit()} disabled={busy}>{busy ? "Salvando..." : "Salvar fonte"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
