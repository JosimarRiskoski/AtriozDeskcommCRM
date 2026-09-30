export function campaignReplyDueAt(repliedAt: string | null, delaySeconds: number): Date {
  const base = repliedAt ? new Date(repliedAt).getTime() : Date.now();
  return new Date(base + Math.max(0, delaySeconds) * 1000);
}

export function campaignReplyAudioDestination(input: {
  organizationId: string;
  conversationId: string;
  campaignId: string;
  recipientId: string;
  sourcePath: string;
}): string {
  const filename = input.sourcePath.split("/").pop() || "reply-audio.ogg";
  return `${input.organizationId}/${input.conversationId}/campaign-${input.campaignId}-reply-${input.recipientId}-${filename}`;
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
