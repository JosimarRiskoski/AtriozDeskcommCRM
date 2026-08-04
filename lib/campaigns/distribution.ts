import { createHash } from "node:crypto";

export interface CampaignConnectionCapacity {
  id: string;
  label: string;
  remainingCapacity: number;
}

export interface CampaignRecipientInput {
  key: string;
}

export interface CampaignAssignment<T extends CampaignRecipientInput> {
  recipient: T;
  channelSessionId: string;
  connectionPosition: number;
}

/**
 * Embaralhamento estável e leve: muda apenas a ordem, nunca escolhe conexão
 * aleatoriamente. Depois distribui pelo menor número atribuído, respeitando a
 * capacidade restante de cada conexão.
 */
export function distributeCampaignRecipients<T extends CampaignRecipientInput>(
  recipients: T[],
  connections: CampaignConnectionCapacity[],
  seed: string,
): {
  assignments: CampaignAssignment<T>[];
  excludedByCapacity: T[];
  counts: Record<string, number>;
} {
  const healthy = connections.filter((connection) => connection.remainingCapacity > 0);
  const ordered = recipients
    .slice()
    .sort((a, b) => stableScore(seed, a.key).localeCompare(stableScore(seed, b.key)));
  const counts = Object.fromEntries(healthy.map((connection) => [connection.id, 0]));
  const assignments: CampaignAssignment<T>[] = [];
  const excludedByCapacity: T[] = [];
  for (const recipient of ordered) {
    const candidate = healthy
      .filter((connection) => (counts[connection.id] ?? 0) < connection.remainingCapacity)
      .sort((a, b) => (counts[a.id] ?? 0) - (counts[b.id] ?? 0) || a.id.localeCompare(b.id))[0];
    if (!candidate) {
      excludedByCapacity.push(recipient);
      continue;
    }
    const position = counts[candidate.id] ?? 0;
    assignments.push({ recipient, channelSessionId: candidate.id, connectionPosition: position });
    counts[candidate.id] = position + 1;
  }
  return { assignments, excludedByCapacity, counts };
}

function stableScore(seed: string, value: string) {
  return createHash("sha256").update(`${seed}:${value}`).digest("hex");
}

export function estimateCampaignSchedule(input: {
  now: Date;
  timezone: string;
  businessStart: string;
  businessEnd: string;
  intervalSeconds: number;
  counts: Record<string, number>;
}) {
  // O worker possui uma cadência global por campanha. As conexões alternam os
  // destinatários, mas não enviam em paralelo no mesmo instante. A previsão
  // usa o total para nunca prometer um prazo mais curto que a execução real.
  const totalRecipients = Object.values(input.counts).reduce((sum, count) => sum + count, 0);
  const maxRecipients = Math.max(0, ...Object.values(input.counts));
  const activeSeconds = Math.max(0, totalRecipients - 1) * input.intervalSeconds;
  const startMinutes = hhmm(input.businessStart);
  const endMinutes = hhmm(input.businessEnd);
  const windowSeconds = Math.max(60, (endMinutes - startMinutes) * 60);
  const localMinutes = minutesInTimezone(input.now, input.timezone);
  let startDelaySeconds = 0;
  if (localMinutes < startMinutes) startDelaySeconds = (startMinutes - localMinutes) * 60;
  else if (localMinutes >= endMinutes)
    startDelaySeconds = (24 * 60 - localMinutes + startMinutes) * 60;
  const projectedStart = new Date(input.now.getTime() + startDelaySeconds * 1000);
  const projectedLocalMinutes = startDelaySeconds ? startMinutes : localMinutes;
  let workingRemaining = activeSeconds;
  let wallSeconds = 0;
  const todayAvailable = Math.max(0, (endMinutes - projectedLocalMinutes) * 60);
  if (workingRemaining <= todayAvailable) wallSeconds = workingRemaining;
  else {
    workingRemaining -= todayAvailable;
    wallSeconds += todayAvailable + (24 * 3600 - windowSeconds);
    const fullWindows = Math.floor(workingRemaining / windowSeconds);
    wallSeconds += fullWindows * 24 * 3600;
    workingRemaining -= fullWindows * windowSeconds;
    wallSeconds += workingRemaining;
  }
  const projectedEnd = new Date(projectedStart.getTime() + wallSeconds * 1000);
  return {
    projectedStart: projectedStart.toISOString(),
    projectedEnd: projectedEnd.toISOString(),
    durationSeconds: startDelaySeconds + wallSeconds,
    activeSendingSeconds: activeSeconds,
    intervalSeconds: input.intervalSeconds,
    businessWindow: `${input.businessStart}–${input.businessEnd}`,
    maxRecipientsPerConnection: maxRecipients,
    totalRecipients,
    executionMode: "global_interval" as const,
  };
}

function hhmm(value: string) {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function minutesInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return (
    Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 +
    Number(parts.find((part) => part.type === "minute")?.value ?? 0)
  );
}
