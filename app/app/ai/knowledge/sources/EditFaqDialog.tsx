"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api/client";
import type { SourceRow } from "@/hooks/ai/useKnowledgeSources";

interface FaqItem {
  question: string;
  answer: string;
  tags: string[];
}

interface DetailResponse {
  data: {
    source: SourceRow;
    items: FaqItem[];
  };
}

function itemsToMarkdown(items: FaqItem[]): string {
  return items
    .map((item) => `## Pergunta: ${item.question}\n## Resposta: ${item.answer}`)
    .join("\n\n");
}

export function EditFaqDialog({
  source,
  open,
  onOpenChange,
  onSaved,
}: {
  source: SourceRow | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSaved: () => void;
}) {
  const [markdown, setMarkdown] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !source) return;
    let active = true;
    setLoading(true);
    apiClient
      .get<DetailResponse>(`/api/v1/ai/knowledge/sources/${source.id}`)
      .then((response) => {
        if (active) setMarkdown(itemsToMarkdown(response.data.items ?? []));
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : "Não foi possível carregar a FAQ.");
        onOpenChange(false);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, source, onOpenChange]);

  async function save() {
    if (!source || markdown.trim().length === 0) {
      toast.error("Inclua pelo menos uma pergunta e resposta.");
      return;
    }
    setSaving(true);
    try {
      await apiClient.patch(`/api/v1/ai/knowledge/sources/${source.id}`, {
        markdown_blob: markdown.trim(),
      });
      toast.success("FAQ salva. A reindexação foi iniciada em segundo plano.");
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar a FAQ.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Editar conteúdo da FAQ</DialogTitle>
          <DialogDescription>
            Cada pergunta e resposta vira um trecho independente da base de conhecimento da Sophia.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="edit-knowledge-faq">Perguntas e respostas</Label>
          <Textarea
            id="edit-knowledge-faq"
            rows={18}
            value={markdown}
            onChange={(event) => setMarkdown(event.target.value)}
            disabled={loading || saving}
            placeholder={"## Pergunta: Quanto posso economizar?\n## Resposta: A economia depende da análise da unidade."}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Use “## Pergunta:” e “## Resposta:”. Salvar substitui os itens atuais e reindexa a fonte.
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void save()} disabled={loading || saving}>
            {loading ? "Carregando..." : saving ? "Salvando..." : "Salvar e reindexar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
