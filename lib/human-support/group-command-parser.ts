const COMMAND = /^CASO\s+([0-9a-f]{8}-[0-9a-f-]{27,})\s+(RESOLVER|PEDIR)\s+([\s\S]{1,4000})$/i;

export function parseManagerGroupCommand(
  body: string | null | undefined,
): { caseId: string; action: "RESOLVER" | "PEDIR"; body: string } | null {
  const parsed = COMMAND.exec(body?.trim() ?? "");
  if (!parsed) return null;
  return {
    caseId: parsed[1]!,
    action: parsed[2]!.toUpperCase() as "RESOLVER" | "PEDIR",
    body: parsed[3]!.trim(),
  };
}
