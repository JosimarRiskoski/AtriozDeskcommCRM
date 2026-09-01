"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";

export const INBOX_LIST_DEFAULT_WIDTH = 380;
export const INBOX_LIST_MIN_WIDTH = 300;
export const INBOX_LIST_MAX_WIDTH = 520;

export function clampInboxListWidth(width: number): number {
  return Math.min(INBOX_LIST_MAX_WIDTH, Math.max(INBOX_LIST_MIN_WIDTH, Math.round(width)));
}

interface InboxResizeHandleProps {
  width: number;
  onWidthChange: (width: number) => void;
  onReset: () => void;
}

export function InboxResizeHandle({ width, onWidthChange, onReset }: InboxResizeHandleProps) {
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    onWidthChange(clampInboxListWidth(drag.startWidth + event.clientX - drag.startX));
  };

  const finishPointerDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft") nextWidth = width - 16;
    if (event.key === "ArrowRight") nextWidth = width + 16;
    if (event.key === "Home") nextWidth = INBOX_LIST_MIN_WIDTH;
    if (event.key === "End") nextWidth = INBOX_LIST_MAX_WIDTH;
    if (nextWidth === null) return;
    event.preventDefault();
    onWidthChange(clampInboxListWidth(nextWidth));
  };

  return (
    <button
      type="button"
      role="separator"
      aria-label="Redimensionar lista de conversas"
      aria-orientation="vertical"
      aria-valuemin={INBOX_LIST_MIN_WIDTH}
      aria-valuemax={INBOX_LIST_MAX_WIDTH}
      aria-valuenow={width}
      title="Arraste para redimensionar. Clique duas vezes para restaurar."
      className="group relative hidden h-full cursor-col-resize touch-none select-none items-center justify-center border-x border-border bg-background transition-colors hover:bg-accent-soft focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex"
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerDrag}
      onPointerCancel={finishPointerDrag}
    >
      <span className="h-10 w-0.5 rounded-full bg-border-strong transition-all group-hover:h-16 group-hover:bg-accent" />
    </button>
  );
}
