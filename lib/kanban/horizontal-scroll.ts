/** A distância horizontal que ainda pode ser percorrida no quadro. */
export function getKanbanHorizontalScrollMax(scrollWidth: number, clientWidth: number): number {
  return Math.max(0, Math.ceil(scrollWidth - clientWidth));
}
