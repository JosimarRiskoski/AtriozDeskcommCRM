export function campaignReplyDueAt(repliedAt: string | null, delaySeconds: number): Date {
  const base = repliedAt ? new Date(repliedAt).getTime() : Date.now();
  return new Date(base + Math.max(0, delaySeconds) * 1000);
}

export function shouldAdvanceCampaignLead(input: {
  leadPipelineId: string;
  campaignPipelineId: string;
  currentStagePosition: number;
  targetStagePosition: number;
}): boolean {
  return (
    input.leadPipelineId === input.campaignPipelineId &&
    input.targetStagePosition > input.currentStagePosition
  );
}
