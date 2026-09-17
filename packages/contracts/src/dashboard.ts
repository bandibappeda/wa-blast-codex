import { z } from "zod";

export const dashboardResponseSchema = z.object({
  queue: z.object({ depth: z.number().int().nonnegative(), oldestPendingAt: z.string().datetime({ offset: true }).nullable(), oldestPendingAgeSeconds: z.number().int().nonnegative().nullable() }),
  approvals: z.object({ pending: z.number().int().nonnegative() }),
  activeCampaigns: z.array(z.object({ id: z.string(), name: z.string(), state: z.string(), total: z.number().int().nonnegative(), pending: z.number().int().nonnegative(), sent: z.number().int().nonnegative(), delivered: z.number().int().nonnegative(), read: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), progressPercent: z.number().min(0).max(100) })),
  gateways: z.object({ total: z.number().int().nonnegative(), healthy: z.number().int().nonnegative(), unhealthy: z.number().int().nonnegative(), unknown: z.number().int().nonnegative() }),
  delivery: z.object({ total: z.number().int().nonnegative(), pending: z.number().int().nonnegative(), retrying: z.number().int().nonnegative(), sent: z.number().int().nonnegative(), delivered: z.number().int().nonnegative(), read: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), successRate: z.number().min(0).max(100).nullable() }),
  recentFailures: z.array(z.object({ jobId: z.string(), campaignId: z.string(), campaignName: z.string(), recipientName: z.string(), message: z.string(), updatedAt: z.string().datetime({ offset: true }) })),
});

export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
