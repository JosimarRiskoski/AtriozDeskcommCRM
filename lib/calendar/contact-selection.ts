/** Ao limpar a busca do agendamento, não pode permanecer um contato invisível selecionado. */
export function shouldClearAppointmentContact(search: string, fixedContactId: string | null | undefined): boolean {
  return !fixedContactId && search.trim().length === 0;
}
