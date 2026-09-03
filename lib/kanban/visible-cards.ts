/** Número de cartões expostos inicialmente em cada etapa do Kanban. */
export const KANBAN_COLLAPSED_CARD_LIMIT = 3;

export function getVisibleKanbanCards<T>(cards: T[], expanded: boolean): T[] {
  return expanded ? cards : cards.slice(0, KANBAN_COLLAPSED_CARD_LIMIT);
}
