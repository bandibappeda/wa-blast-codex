export const campaignStates = [
  "draft",
  "pending_approval",
  "approved",
  "scheduled",
  "queued",
  "running",
  "completed",
  "completed_with_failures",
  "cancelled",
] as const;

export type CampaignState = typeof campaignStates[number];

const transitions: Record<CampaignState, readonly CampaignState[]> = {
  draft: ["pending_approval", "cancelled"],
  pending_approval: ["draft", "approved", "cancelled"],
  approved: ["draft", "scheduled", "queued", "cancelled"],
  scheduled: ["draft", "queued", "cancelled"],
  queued: ["running", "cancelled"],
  running: ["completed", "completed_with_failures", "cancelled"],
  completed: [],
  completed_with_failures: [],
  cancelled: [],
};

export function canTransition(from: CampaignState, to: CampaignState): boolean {
  return transitions[from].includes(to);
}

export function assertCampaignTransition(from: CampaignState, to: CampaignState): void {
  if (!canTransition(from, to)) throw new CampaignStateError(from, to);
}

export class CampaignStateError extends Error {
  constructor(readonly from: CampaignState, readonly to: CampaignState) { super(`invalid_campaign_transition:${from}:${to}`); }
}
