"use client";
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { MessageTemplate } from "@/hooks/inbox/useMessageTemplates";
import { Copy } from "@/lib/ui/icons";
import { copyToClipboard } from "@/lib/clipboard";
import { StepProgress } from "@/components/ui/step-progress";

const TEMPLATES_KEY = ["message-templates"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canShare: boolean;
  template?: MessageTemplate | null;
}

interface CreateInput {
  title: string;
  body: string;
  shortcut?: string;
  shared?: boolean;
  kind: "text" | "poll";
  interactive_config?: { options: string[]; multipleAnswers: boolean } | null;
}

interface UpdateInput {
  id: string;
  title: string;
  body: string;
  shortcut: string | null;
  kind: "text" | "poll";
  interactive_config: { options: string[]; multipleAnswers: boolean } | null;
}

export function TemplateFormDialog({ open, onOpenChange, canShare, template }: Props) {
  const isEdit = !!template;
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [shortcut, setShortcut] = React.useState("");
  const [shared, setShared] = React.useState(false);
  const [kind, setKind] = React.useState<"text" | "poll">("text");
  const [pollOptions, setPollOptions] = React.useState<string[]>(["Sim", "Não"]);
  const [multipleAnswers, setMultipleAnswers] = React.useState(false);
  const [step, setStep] = React.useState(0);

  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: async (input: CreateInput) =>
      apiClient.post<{ data: MessageTemplate }>("/api/v1/message-templates", input),
    onError: showApiError,
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...input }: UpdateInput) =>
      apiClient.patch<{ data: MessageTemplate }>(`/api/v1/message-templates/${id}`, input),
    onError: showApiError,
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
  const pending = create.isPending || update.isPending;

  React.useEffect(() => {
    if (!open) return;
    setStep(0);
    // O formulário permanece montado entre aberturas; ao trocar de template,
    // este reset deliberado impede que dados do item anterior sejam salvos no próximo.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTitle(template?.title ?? "");
    setBody(template?.body ?? "");
    setShortcut(template?.shortcut ?? "");
    setShared(template ? template.owner_user_id === null : false);
    setKind(template?.kind ?? "text");
    setPollOptions(template?.interactive_config?.options ?? ["Sim", "Não"]);
    setMultipleAnswers(template?.interactive_config?.multipleAnswers ?? false);
  }, [open, template]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isEdit) {
        await update.mutateAsync({
          id: template.id,
          title,
          body,
          shortcut: shortcut.trim() || null,
          kind,
          interactive_config: kind === "poll" ? { options: pollOptions, multipleAnswers } : null,
        });
        toast.success("Template atualizado.");
      } else {
        await create.mutateAsync({
          title,
          body,
          shortcut: shortcut.trim() || undefined,
          shared: canShare ? shared : false,
          kind,
          interactive_config: kind === "poll" ? { options: pollOptions, multipleAnswers } : null,
        });
        toast.success("Template criado.");
      }
      onOpenChange(false);
    } catch {
      /* erro já mostrado pelo showApiError */
    }
  };

  const copyVariable = async (variable: string) => {
    const copied = await copyToClipboard(variable);
    if (copied) toast.success(`${variable} copiado.`);
    else toast.error("Não foi possível copiar a variável.");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar template" : "Novo template"}</DialogTitle>
          <DialogDescription>
            Scripts salvos para responder mais rápido no atendimento.
          </DialogDescription>
        </DialogHeader>
        <StepProgress labels={["Dados", "Conteúdo"]} current={step} />
        <form onSubmit={onSubmit} className="space-y-4">
          <div className={step === 0 ? "space-y-2" : "hidden"}>
            <Label>Formato</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={kind === "text" ? "secondary" : "outline"}
                onClick={() => setKind("text")}
              >
                Texto
              </Button>
              <Button
                type="button"
                variant={kind === "poll" ? "secondary" : "outline"}
                onClick={() => setKind("poll")}
              >
                Enquete interativa
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              A enquete usa o recurso nativo do WhatsApp. Se o provedor recusar, o sistema envia
              automaticamente as opções numeradas em texto.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tpl-title">Título</Label>
            <Input
              id="tpl-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Saudação inicial"
              minLength={1}
              maxLength={80}
              required
            />
          </div>
          {step === 1 && kind === "poll" && (
            <div className="space-y-3 rounded-md border p-3">
              <div>
                <Label>Opções da enquete</Label>
                <p className="text-xs text-muted-foreground">Mínimo 2 e máximo 12 opções.</p>
              </div>
              {pollOptions.map((option, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={option}
                    onChange={(e) =>
                      setPollOptions((current) =>
                        current.map((value, i) => (i === index ? e.target.value : value)),
                      )
                    }
                    placeholder={`Opção ${index + 1}`}
                    maxLength={100}
                    required
                  />
                  {pollOptions.length > 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setPollOptions((current) => current.filter((_, i) => i !== index))
                      }
                    >
                      Remover
                    </Button>
                  )}
                </div>
              ))}
              {pollOptions.length < 12 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPollOptions((current) => [...current, ""])}
                >
                  Adicionar opção
                </Button>
              )}
              <div className="flex items-center gap-2">
                <Switch
                  id="poll-multiple"
                  checked={multipleAnswers}
                  onCheckedChange={setMultipleAnswers}
                />
                <Label htmlFor="poll-multiple">Permitir mais de uma resposta</Label>
              </div>
            </div>
          )}
          <div className={step === 1 ? "space-y-2" : "hidden"}>
            <Label htmlFor="tpl-body">Mensagem</Label>
            <Textarea
              id="tpl-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Oi {{primeiro_nome}}, tudo bem?"
              minLength={1}
              maxLength={4096}
              required
              rows={5}
            />
            <div className="bg-muted/30 rounded-md border p-3">
              <p className="mb-2 text-xs font-medium">Variáveis disponíveis</p>
              <div className="flex flex-wrap gap-2">
                {["{{primeiro_nome}}", "{{nome}}"].map((variable) => (
                  <Button
                    key={variable}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 font-mono text-xs"
                    onClick={() => void copyVariable(variable)}
                    title={`Copiar ${variable}`}
                  >
                    <Copy size={13} aria-hidden />
                    {variable}
                  </Button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Clique para copiar e cole no ponto desejado da mensagem.
              </p>
            </div>
          </div>
          <div className={step === 0 ? "space-y-2" : "hidden"}>
            <Label htmlFor="tpl-shortcut">Atalho (opcional)</Label>
            <Input
              id="tpl-shortcut"
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value)}
              placeholder="oi"
              maxLength={40}
            />
          </div>
          {step === 0 && canShare && (
            <div className="flex items-center gap-2">
              <Switch
                id="tpl-shared"
                checked={shared}
                onCheckedChange={setShared}
                disabled={isEdit}
              />
              <Label htmlFor="tpl-shared">Compartilhar com a equipe</Label>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            {step === 1 ? (
              <Button type="button" variant="outline" onClick={() => setStep(0)} disabled={pending}>
                Voltar
              </Button>
            ) : null}
            {step === 0 ? (
              <Button type="button" onClick={() => setStep(1)} disabled={!title.trim()}>
                Continuar
              </Button>
            ) : null}
            {step === 1 ? (
              <Button type="submit" disabled={pending}>
                {isEdit ? "Salvar" : "Criar template"}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
