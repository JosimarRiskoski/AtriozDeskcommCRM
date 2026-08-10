"use client";
import { format } from "date-fns";
import type { ReactNode } from "react";
import { ptBR } from "date-fns/locale";
import { Check, Checks, Robot, WarningOctagon } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Message } from "@/lib/types/messaging";
import { CitationButton } from "@/components/ai/CitationButton";
import { MediaRenderer } from "@/components/inbox/media/MediaRenderer";
import {
  extractCitations,
  isAiGeneratedMessage,
} from "@/lib/ai/citations/types";

interface Props {
  message: Message;
  debugCitations?: boolean;
}

function AckIndicator({
  status,
  ack,
  messageType,
}: {
  status: string;
  ack: number | null;
  messageType: string;
}) {
  let indicator: ReactNode = null;
  let label = "";
  if ((ack ?? 0) >= 4 && messageType === "audio") {
    label = "Reproduzida";
    indicator = <Checks size={12} weight="bold" className="text-blue-400" aria-label={label} />;
  } else if (status === "read") {
    label = "Lida";
    indicator = <Checks size={12} weight="bold" className="text-blue-400" aria-label={label} />;
  } else if (status === "delivered") {
    label = "Entregue";
    indicator = <Checks size={12} weight="bold" className="text-current/70" aria-label={label} />;
  } else if (status === "sent") {
    label = "Enviada";
    indicator = <Check size={12} weight="bold" className="text-current/70" aria-label={label} />;
  }
  if (!indicator) return null;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild><span className="inline-flex">{indicator}</span></TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function MessageBubble({ message, debugCitations }: Props) {
  const isOutbound = message.direction === "outbound";
  const time = format(new Date(message.sent_at), "HH:mm", { locale: ptBR });
  const isFailed = message.status === "failed";
  const hasMedia = Boolean(message.media_url || message.media_storage_path);
  // Figurinha sem caption: sem moldura de bolha (padrão WhatsApp).
  const isBareSticker = hasMedia && message.type === "sticker" && !message.body;
  const aiGenerated = isAiGeneratedMessage(message.metadata);
  const citations = extractCitations(message.metadata);
  const showCitationButton =
    isOutbound && aiGenerated && (debugCitations ?? false);
  const senderLabel = (() => {
    if (!isOutbound) return null;
    if (message.sent_via === "ai") return "IA";
    return null;
  })();

  return (
    <div className={cn("flex w-full px-4 py-1", isOutbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] text-sm",
          isBareSticker
            ? "px-0 py-0"
            : cn(
                "rounded-2xl px-3 py-2 shadow-sm",
                isOutbound
                  ? "rounded-br-sm bg-primary text-primary-foreground"
                  : "rounded-bl-sm bg-muted text-foreground",
              ),
          isFailed && "border border-destructive",
        )}
      >
        {senderLabel && (
          <div className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-80">
            {senderLabel === "IA" ? (
              <Robot size={10} weight="duotone" aria-hidden />
            ) : null}
            {senderLabel}
          </div>
        )}

        {hasMedia && (
          <div className={cn(message.body && "mb-1")}>
            <MediaRenderer message={message} />
          </div>
        )}

        {message.body && (
          <p className="whitespace-pre-wrap break-words leading-snug">{message.body}</p>
        )}

        <div
          className={cn(
            "mt-1 flex items-center justify-end gap-1 text-[10px]",
            isOutbound ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          <span>{time}</span>
          {showCitationButton && (
            <CitationButton citations={citations} messageId={message.id} />
          )}
          {isOutbound && !isFailed && (
            <AckIndicator status={message.status} ack={message.ack} messageType={message.type} />
          )}
          {isFailed && (
            // Provider local: o painel do inbox não tem TooltipProvider ancestral e
            // este Tooltip só monta em mensagem failed — sem o provider, abrir uma
            // conversa com falha de envio derrubava o painel inteiro (error boundary).
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-0.5 font-semibold text-destructive">
                    <WarningOctagon size={10} weight="fill" aria-hidden /> Falhou
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {message.error_message ?? message.error_code ?? "Erro desconhecido"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
    </div>
  );
}
