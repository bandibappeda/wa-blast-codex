import { z } from "zod";

export const campaignCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  gatewayId: z.string().trim().min(1),
  templateId: z.string().trim().min(1),
  scheduleAt: z.string().datetime({ offset: true }).nullable().optional(),
  contactIds: z.array(z.string().trim().min(1)).max(10_000).default([]),
  tagNames: z.array(z.string().trim().min(1).max(50)).max(100).default([]),
});

export const campaignUpdateRequestSchema = campaignCreateRequestSchema.partial().extend({
  version: z.number().int().min(1),
});

export const campaignSubmitRequestSchema = z.object({
  version: z.number().int().min(1),
});

export const campaignApprovalRequestSchema = z.object({
  version: z.number().int().min(1),
});

export type CampaignCreateRequest = z.infer<typeof campaignCreateRequestSchema>;
export type CampaignUpdateRequest = z.infer<typeof campaignUpdateRequestSchema>;
