/**
 * Indica se ainda há cartões abaixo da área visível de uma coluna do Kanban.
 * A coluna continua mostrando todos os negócios; a dica só torna a rolagem
 * perceptível quando o último cartão ficaria parcialmente oculto.
 */
export function shouldShowKanbanOverflowCue({
  scrollTop,
  clientHeight,
  scrollHeight,
}: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): boolean {
  const hasOverflow = scrollHeight > clientHeight + 1;
  const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1;

  return hasOverflow && !isAtBottom;
}
