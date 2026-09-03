/**
 * Decide o item ativo da navegação principal.
 *
 * O Kanban abre o funil selecionado em `/app/pipelines/:id`; essa rota é uma
 * continuação do Kanban, não uma seção independente da barra lateral.
 */
export function isSidebarNavActive(pathname: string, href: string): boolean {
  if (pathname === href || pathname.startsWith(`${href}/`)) return true;
  return href === "/app/kanban" && pathname.startsWith("/app/pipelines/");
}
