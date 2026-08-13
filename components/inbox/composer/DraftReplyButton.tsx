"use client";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Sparkle } from "@/lib/ui/icons";
import { useDraftReply } from "@/hooks/inbox/useDraftReply";

interface Props {
  conversationId: string;
  onDraft: (text: string) => void;
  disabled?: boolean;
}

/** Onda 5.1: botão "Sugerir resposta" — gera rascunho via agente publicado, sem enviar. */
export function DraftReplyButton({ conversationId, onDraft, disabled }: Props) {
  const mutation = useDraftReply();

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-9 w-9 shrink-0"
            aria-label="Sugerir resposta com IA"
            aria-busy={mutation.isPending}
            disabled={disabled || mutation.isPending}
            onClick={() => {
              mutation.mutate(conversationId, {
                onSuccess: (res) => onDraft(res.data.draft),
              });
            }}
          >
            <Sparkle size={18} weight={mutation.isPending ? "duotone" : "regular"} aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-64 text-center">
          Sugerir resposta com IA. O texto será colocado no campo para você revisar antes de enviar.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
