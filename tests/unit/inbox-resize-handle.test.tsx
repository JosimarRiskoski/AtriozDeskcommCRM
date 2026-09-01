import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clampInboxListWidth,
  InboxResizeHandle,
  INBOX_LIST_DEFAULT_WIDTH,
  INBOX_LIST_MAX_WIDTH,
  INBOX_LIST_MIN_WIDTH,
} from "@/components/inbox/InboxResizeHandle";

afterEach(cleanup);

describe("InboxResizeHandle", () => {
  it("limita a largura à faixa segura", () => {
    expect(clampInboxListWidth(100)).toBe(INBOX_LIST_MIN_WIDTH);
    expect(clampInboxListWidth(999)).toBe(INBOX_LIST_MAX_WIDTH);
    expect(clampInboxListWidth(411.6)).toBe(412);
  });

  it("permite ajuste acessível pelo teclado", () => {
    const onWidthChange = vi.fn();
    render(
      <InboxResizeHandle
        width={INBOX_LIST_DEFAULT_WIDTH}
        onWidthChange={onWidthChange}
        onReset={() => {}}
      />,
    );
    const separator = screen.getByRole("separator", { name: "Redimensionar lista de conversas" });

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    fireEvent.keyDown(separator, { key: "Home" });
    fireEvent.keyDown(separator, { key: "End" });

    expect(onWidthChange).toHaveBeenNthCalledWith(1, INBOX_LIST_DEFAULT_WIDTH + 16);
    expect(onWidthChange).toHaveBeenNthCalledWith(2, INBOX_LIST_MIN_WIDTH);
    expect(onWidthChange).toHaveBeenNthCalledWith(3, INBOX_LIST_MAX_WIDTH);
  });

  it("restaura o padrão com clique duplo", () => {
    const onReset = vi.fn();
    render(
      <InboxResizeHandle
        width={INBOX_LIST_MAX_WIDTH}
        onWidthChange={() => {}}
        onReset={onReset}
      />,
    );

    fireEvent.doubleClick(
      screen.getByRole("separator", { name: "Redimensionar lista de conversas" }),
    );
    expect(onReset).toHaveBeenCalledOnce();
  });
});
